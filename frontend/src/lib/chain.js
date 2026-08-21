import { Contract, JsonRpcProvider, id as keccakId } from 'ethers';
import { CONTRACT_ADDRESS } from './api';

/*
 * A read-only connection to the chain, made straight from the browser.
 *
 * This deliberately does not go through our backend. The whole claim of the
 * product is that the proof is public and independently checkable - so the
 * screen that demonstrates it should be checkable without trusting our API
 * either. Anyone can open the console here and re-run these calls against a
 * public RPC node.
 */

export const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

// The block the contract was deployed in. Without it, an event scan would walk
// the entire chain from genesis, which public RPC nodes will refuse.
export const DEPLOY_BLOCK = Number(import.meta.env.VITE_CONTRACT_DEPLOY_BLOCK || 0);

export const KYC_VAULT_ABI = [
  'function operator() view returns (address)',
  'function kycProofs(string) view returns (bytes32 payloadHash, uint256 verifiedAt, bool isValid, address verifierBank)',
  'function hasConsent(string customerId, bytes32 partnerIdHash) view returns (bool)',
  'function checkStatus(string customerId, bytes32 partnerIdHash) view returns (bool consentGranted, bool isVerified, bytes32 payloadHash, uint256 verifiedAt, address verifierBank)',
  'event KYCVerified(string indexed customerId, address indexed verifierBank, bytes32 payloadHash)',
  'event ConsentGranted(string indexed customerId, bytes32 indexed partnerIdHash)',
  'event ConsentRevoked(string indexed customerId, bytes32 indexed partnerIdHash)'
];

let provider = null;

export function getProvider() {
  if (!provider) {
    // staticNetwork avoids a chainId round-trip on every single call.
    provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  }

  return provider;
}

export function getContract() {
  if (!CONTRACT_ADDRESS) {
    throw new Error('VITE_CONTRACT_ADDRESS is not configured.');
  }

  return new Contract(CONTRACT_ADDRESS, KYC_VAULT_ABI, getProvider());
}

/* The backend normalises partner IDs to lowercase before hashing. Diverging
 * here would silently produce "no consent" for a partner that does have it. */
export function partnerIdHash(partnerId) {
  return keccakId(String(partnerId || '').trim().toLowerCase());
}

/*
 * Public RPC nodes cap eth_getLogs ranges - commonly at 10k blocks, sometimes
 * lower, and they disagree about the error they return. Rather than guess, we
 * walk backwards from the head in bounded windows and stop at the first
 * window that errors, returning whatever we already have.
 */
const WINDOW = 9000;
const MAX_WINDOWS = 40;

export async function fetchEvents({ customerId = null, onProgress } = {}) {
  const contract = getContract();
  const head = await getProvider().getBlockNumber();
  const floor = DEPLOY_BLOCK > 0 ? DEPLOY_BLOCK : Math.max(0, head - WINDOW * MAX_WINDOWS);

  const filters = [
    { name: 'KYCVerified', filter: contract.filters.KYCVerified(customerId || null) },
    { name: 'ConsentGranted', filter: contract.filters.ConsentGranted(customerId || null) },
    { name: 'ConsentRevoked', filter: contract.filters.ConsentRevoked(customerId || null) }
  ];

  const collected = [];
  let to = head;
  let windows = 0;
  let truncated = false;

  while (to >= floor && windows < MAX_WINDOWS) {
    const from = Math.max(floor, to - WINDOW + 1);

    try {
      const results = await Promise.all(
        filters.map(({ filter }) => contract.queryFilter(filter, from, to))
      );

      results.forEach((logs, index) => {
        for (const log of logs) {
          collected.push({
            name: filters[index].name,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            // `customerId` is an indexed string, so the chain stores only its
            // keccak256 hash in the topic. The readable value is genuinely not
            // recoverable from the log - which is itself part of the privacy story.
            customerTopic: log.topics[1] || null,
            partnerTopic: filters[index].name === 'KYCVerified' ? null : log.topics[2] || null,
            payloadHash: filters[index].name === 'KYCVerified' ? log.args?.payloadHash ?? null : null,
            verifierBank: filters[index].name === 'KYCVerified' ? log.args?.verifierBank ?? null : null
          });
        }
      });
    } catch {
      truncated = true;
      break;
    }

    onProgress?.({ scannedTo: from, head, floor });
    to = from - 1;
    windows += 1;
  }

  if (to >= floor && windows >= MAX_WINDOWS) {
    truncated = true;
  }

  collected.sort((a, b) => b.blockNumber - a.blockNumber);

  return { events: collected, head, scannedFrom: Math.max(floor, to + 1), truncated };
}
