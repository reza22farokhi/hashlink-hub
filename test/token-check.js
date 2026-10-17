const fs = require("fs");
const assert = require("assert");

describe("HashLink Token source checks", function () {
  const source = fs.readFileSync(
    "contracts/HashLinkToken.sol",
    "utf8"
  );

  it("uses the expected token name and symbol", function () {
    assert(source.includes('ERC20("HashLink Token", "HLT")'));
  });

  it("defines a fixed supply of one billion tokens", function () {
    assert(source.includes("1_000_000_000 * 10**18"));
  });

  it("mints the supply only in the constructor", function () {
    assert(source.includes("_mint(msg.sender, TOTAL_SUPPLY)"));
    assert(!/function\s+mint\s*\(/.test(source));
  });
});
