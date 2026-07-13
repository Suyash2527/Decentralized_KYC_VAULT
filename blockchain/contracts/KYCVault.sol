// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract KYCVault {
    struct KYCProof {
        bytes32 payloadHash;
        uint256 verifiedAt;
        bool isValid;
        address verifierBank;
    }

    address public immutable operator;

    mapping(string => KYCProof) public kycProofs;
    mapping(string => mapping(bytes32 => bool)) private consentList;

    event KYCVerified(string indexed customerId, address indexed verifierBank, bytes32 payloadHash);
    event ConsentGranted(string indexed customerId, bytes32 indexed partnerIdHash);
    event ConsentRevoked(string indexed customerId, bytes32 indexed partnerIdHash);

    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator can perform this action");
        _;
    }

    constructor(address operatorAddress) {
        require(operatorAddress != address(0), "Operator address required");
        operator = operatorAddress;
    }

    function verifyKYC(string calldata customerId, bytes32 payloadHash) external onlyOperator {
        require(bytes(customerId).length > 0, "Customer ID required");
        require(!kycProofs[customerId].isValid, "KYC already verified");

        kycProofs[customerId] = KYCProof({
            payloadHash: payloadHash,
            verifiedAt: block.timestamp,
            isValid: true,
            verifierBank: msg.sender
        });

        emit KYCVerified(customerId, msg.sender, payloadHash);
    }

    function grantConsent(string calldata customerId, bytes32 partnerIdHash) external onlyOperator {
        require(kycProofs[customerId].isValid, "No valid KYC proof found");
        consentList[customerId][partnerIdHash] = true;

        emit ConsentGranted(customerId, partnerIdHash);
    }

    function revokeConsent(string calldata customerId, bytes32 partnerIdHash) external onlyOperator {
        require(kycProofs[customerId].isValid, "No valid KYC proof found");
        consentList[customerId][partnerIdHash] = false;

        emit ConsentRevoked(customerId, partnerIdHash);
    }

    function hasConsent(string calldata customerId, bytes32 partnerIdHash) external view returns (bool) {
        return consentList[customerId][partnerIdHash];
    }

    function checkStatus(
        string calldata customerId,
        bytes32 partnerIdHash
    )
        external
        view
        returns (
            bool consentGranted,
            bool isVerified,
            bytes32 payloadHash,
            uint256 verifiedAt,
            address verifierBank
        )
    {
        KYCProof memory proof = kycProofs[customerId];

        if (!proof.isValid) {
            return (false, false, bytes32(0), 0, address(0));
        }

        return (
            consentList[customerId][partnerIdHash],
            true,
            proof.payloadHash,
            proof.verifiedAt,
            proof.verifierBank
        );
    }
}
