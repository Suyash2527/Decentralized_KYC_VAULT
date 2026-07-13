const { expect } = require("chai");

describe("KYCVault", function () {
  let kycVault;
  let operator, attacker;
  const customerId = "CUST123";
  const payloadHash = "0x6f3fef6dc51c7996a74992b70d0c35f328ed9096b9b8ba3e43977e1dfed9bb16";
  const partnerIdHash = ethers.id("bankb");

  beforeEach(async function () {
    const [deployer, _operator, _attacker] = await ethers.getSigners();
    operator = _operator;
    attacker = _attacker;

    const KYCVaultFactory = await ethers.getContractFactory("KYCVault");
    kycVault = await KYCVaultFactory.connect(deployer).deploy(operator.address);
  });

  it("allows the operator to verify a customer", async function () {
    await expect(kycVault.connect(operator).verifyKYC(customerId, payloadHash))
      .to.emit(kycVault, "KYCVerified")
      .withArgs(customerId, operator.address, payloadHash);

    const proof = await kycVault.kycProofs(customerId);
    expect(proof.isValid).to.be.true;
    expect(proof.payloadHash).to.equal(payloadHash);
  });

  it("blocks non-operators from mutating contract state", async function () {
    await expect(kycVault.connect(attacker).verifyKYC(customerId, payloadHash))
      .to.be.revertedWith("Only operator can perform this action");

    await expect(kycVault.connect(attacker).grantConsent(customerId, partnerIdHash))
      .to.be.revertedWith("Only operator can perform this action");

    await expect(kycVault.connect(attacker).revokeConsent(customerId, partnerIdHash))
      .to.be.revertedWith("Only operator can perform this action");
  });

  it("tracks consent status for a hashed partner identifier", async function () {
    await kycVault.connect(operator).verifyKYC(customerId, payloadHash);

    const statusBeforeConsent = await kycVault.checkStatus(customerId, partnerIdHash);
    expect(statusBeforeConsent.consentGranted).to.be.false;
    expect(statusBeforeConsent.isVerified).to.be.true;
    expect(statusBeforeConsent.payloadHash).to.equal(payloadHash);

    await expect(kycVault.connect(operator).grantConsent(customerId, partnerIdHash))
      .to.emit(kycVault, "ConsentGranted")
      .withArgs(customerId, partnerIdHash);

    const statusWithConsent = await kycVault.checkStatus(customerId, partnerIdHash);
    expect(statusWithConsent.consentGranted).to.be.true;
    expect(statusWithConsent.isVerified).to.be.true;
    expect(statusWithConsent.payloadHash).to.equal(payloadHash);

    await expect(kycVault.connect(operator).revokeConsent(customerId, partnerIdHash))
      .to.emit(kycVault, "ConsentRevoked")
      .withArgs(customerId, partnerIdHash);

    const statusAfterRevoke = await kycVault.checkStatus(customerId, partnerIdHash);
    expect(statusAfterRevoke.consentGranted).to.be.false;
    expect(statusAfterRevoke.isVerified).to.be.true;
  });

  it("returns an unverified status for unknown customers", async function () {
    const statusNoConsent = await kycVault.checkStatus("UNKNOWN", partnerIdHash);
    expect(statusNoConsent.consentGranted).to.be.false;
    expect(statusNoConsent.isVerified).to.be.false;
  });
});
