// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract KYCVault {
    // Structure to hold the KYC proof on-chain
    struct KYCProof {
        string payloadHash; // SHA-256 hash of the encrypted PII
        uint256 verifiedAt;
        bool isValid;
        address verifierBank;
    }

    // customerId => KYCProof
    mapping(string => KYCProof) public kycProofs;
    
    // customerId => (partnerBank => hasConsent)
    mapping(string => mapping(address => bool)) public consentList;

    event KYCVerified(string indexed customerId, address indexed verifierBank, string payloadHash);
    event ConsentGranted(string indexed customerId, address indexed partnerBank);
    event ConsentRevoked(string indexed customerId, address indexed partnerBank);

    // Modifier to restrict access to the verifier bank
    modifier onlyVerifier(string memory customerId) {
        require(kycProofs[customerId].verifierBank == msg.sender, "Only verifier bank can update");
        _;
    }

    // Called by the originating bank to mint the KYC proof
    function verifyKYC(string memory customerId, string memory payloadHash) external {
        require(!kycProofs[customerId].isValid, "KYC already verified");
        
        kycProofs[customerId] = KYCProof({
            payloadHash: payloadHash,
            verifiedAt: block.timestamp,
            isValid: true,
            verifierBank: msg.sender
        });

        emit KYCVerified(customerId, msg.sender, payloadHash);
    }

    // Called by customer (or a relay/backend on their behalf) to grant consent
    function grantConsent(string memory customerId, address partnerBank) external {
        require(kycProofs[customerId].isValid, "No valid KYC proof found");
        consentList[customerId][partnerBank] = true;
        
        emit ConsentGranted(customerId, partnerBank);
    }

    // Called by customer to revoke consent
    function revokeConsent(string memory customerId, address partnerBank) external {
        consentList[customerId][partnerBank] = false;
        
        emit ConsentRevoked(customerId, partnerBank);
    }

    // Called by partner bank to verify status
    function checkStatus(string memory customerId, address partnerBank) external view returns (bool hasConsent, string memory payloadHash, uint256 verifiedAt, address verifierBank) {
        hasConsent = consentList[customerId][partnerBank];
        
        if (hasConsent || kycProofs[customerId].verifierBank == partnerBank) {
            KYCProof memory proof = kycProofs[customerId];
            return (true, proof.payloadHash, proof.verifiedAt, proof.verifierBank);
        } else {
            return (false, "", 0, address(0));
        }
    }
}
