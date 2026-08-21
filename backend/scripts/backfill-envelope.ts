import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashData, isLegacyPayload, openPII, sealPII } from '../src/utils/crypto';

/**
 * Re-encrypts every pre-KMS customer record under a fresh per-record data key
 * wrapped by Cloud KMS.
 *
 * Run it with the legacy ENCRYPTION_KEY still present in the environment - that
 * is the only way to read the old rows. Once it reports zero remaining legacy
 * records, remove ENCRYPTION_KEY and ENCRYPTION_KEY_PREVIOUS from the runtime
 * and delete the legacy branch in utils/crypto.ts.
 *
 *   npm run backfill:encryption            # apply
 *   npm run backfill:encryption -- --dry   # report only, no writes
 *
 * Safe to re-run: rows already in v2 format are skipped, and each row is
 * verified by decrypting the new payload and comparing the SHA-256 against the
 * value anchored on-chain before the update is committed.
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry');
const BATCH_SIZE = 100;

async function main(): Promise<void> {
    let cursor: string | undefined;
    let scanned = 0;
    let migrated = 0;
    let skipped = 0;
    const failures: Array<{ publicId: string; reason: string }> = [];

    for (;;) {
        const batch = await prisma.customer.findMany({
            take: BATCH_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' }
        });

        if (batch.length === 0) {
            break;
        }

        cursor = batch[batch.length - 1].id;

        for (const customer of batch) {
            scanned += 1;

            if (!isLegacyPayload(customer.encryptedPII)) {
                skipped += 1;
                continue;
            }

            try {
                const plaintext = await openPII(customer.encryptedPII, customer.publicId);

                // The stored hash is what the smart contract anchored. If the
                // decrypted plaintext no longer hashes to it, the row is already
                // corrupt and must not be silently rewritten.
                if (hashData(plaintext) !== customer.piiHash) {
                    failures.push({
                        publicId: customer.publicId,
                        reason: 'Decrypted payload does not match the stored integrity hash; left untouched.'
                    });
                    continue;
                }

                const { payload, kmsKeyVersion } = await sealPII(plaintext, customer.publicId);

                // Verify the new ciphertext before committing it.
                const roundTrip = await openPII(payload, customer.publicId);

                if (roundTrip !== plaintext) {
                    failures.push({ publicId: customer.publicId, reason: 'Round-trip verification failed.' });
                    continue;
                }

                if (!dryRun) {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { encryptedPII: payload, kmsKeyVersion }
                    });
                }

                migrated += 1;
            } catch (error) {
                failures.push({
                    publicId: customer.publicId,
                    reason: error instanceof Error ? error.message : String(error)
                });
            }
        }

        console.log(`  ...scanned ${scanned}, migrated ${migrated}, already current ${skipped}`);
    }

    console.log('');
    console.log(dryRun ? 'DRY RUN - no rows were written.' : 'Backfill complete.');
    console.log(`  scanned:        ${scanned}`);
    console.log(`  migrated:       ${migrated}`);
    console.log(`  already v2:     ${skipped}`);
    console.log(`  failed:         ${failures.length}`);

    for (const failure of failures) {
        console.error(`  ! ${failure.publicId}: ${failure.reason}`);
    }

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
