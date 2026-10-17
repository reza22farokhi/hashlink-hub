// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract HashLinkAirdrop {
    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    uint256 public immutable deadline;

    mapping(address => bool) public hasClaimed;

    event Claimed(address indexed account, uint256 amount);

    constructor(
        address tokenAddress,
        bytes32 root,
        uint256 claimDeadline
    ) {
        require(tokenAddress != address(0), "Invalid token");
        require(root != bytes32(0), "Invalid root");
        require(
            claimDeadline == 0 || claimDeadline > block.timestamp,
            "Invalid deadline"
        );

        token = IERC20(tokenAddress);
        merkleRoot = root;
        deadline = claimDeadline;
    }

    function claim(
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        require(
            deadline == 0 || block.timestamp <= deadline,
            "Claim period ended"
        );
        require(!hasClaimed[msg.sender], "Already claimed");
        require(amount > 0, "Amount is zero");

        bytes32 leaf = keccak256(
            abi.encode(msg.sender, amount)
        );

        require(
            MerkleProof.verifyCalldata(proof, merkleRoot, leaf),
            "Invalid proof"
        );

        hasClaimed[msg.sender] = true;

        require(
            token.transfer(msg.sender, amount),
            "Transfer failed"
        );

        emit Claimed(msg.sender, amount);
    }
}
