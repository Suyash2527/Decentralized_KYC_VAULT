const { expect } = require("chai");

describe("KYCVault", function () {
  let kycVault;
  let bankA, bankB, customer;

  beforeEach(async function () {
    const [owner, _bankA, _bankB, _customer] = await ethers.getSigners();
    bankA = _bankA;
    bankB = _bankB;
    customer = _customer;

    const KYCVaultFactory = await ethers.getContractFactory("KYCVault");
    kycVault = await KYCVaultFactory.deploy();
  });

  it("should allow Bank A to verify a customer", async function () {
    const customerId = "CUST123";
    const payloadHash = "0xhashofpii";

    await expect(kycVault.connect(bankA).verifyKYC(customerId, payloadHash))
      .to.emit(kycVault, "KYCVerified")
      .withArgs(customerId, bankA.address, payloadHash);

    const proof = await kycVault.kycProofs(customerId);
    expect(proof.isValid).to.be.true;
    expect(proof.payloadHash).to.equal(payloadHash);
  });

  it("should manage consent properly", async function () {
    const customerId = "CUST123";
    const payloadHash = "0xhashofpii";

    await kycVault.connect(bankA).verifyKYC(customerId, payloadHash);

    // Bank B checks status (no consent)
    const statusNoConsent = await kycVault.checkStatus(customerId, bankB.address);
    expect(statusNoConsent.hasConsent).to.be.false;

    // Grant consent to Bank B
    await expect(kycVault.connect(customer).grantConsent(customerId, bankB.address))
      .to.emit(kycVault, "ConsentGranted")
      .withArgs(customerId, bankB.address);

    // Bank B checks status (with consent)
    const statusWithConsent = await kycVault.checkStatus(customerId, bankB.address);
    expect(statusWithConsent.hasConsent).to.be.true;
    expect(statusWithConsent.payloadHash).to.equal(payloadHash);

    // Revoke consent
    await kycVault.connect(customer).revokeConsent(customerId, bankB.address);
    const statusRevoked = await kycVault.checkStatus(customerId, bankB.address);
    expect(statusRevoked.hasConsent).to.be.false;
  });
});
