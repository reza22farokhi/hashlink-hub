// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract HashLinkToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18;

    constructor() ERC20("HashLink Token", "HLT") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
