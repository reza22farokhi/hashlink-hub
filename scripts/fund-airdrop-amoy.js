require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

async function main() {
  const rpc = process.env.POLYGON_AMOY_RPC_URL;
  const key = process.env.PRIVATE_KEY;
  if (!rpc || !key) throw Error('تنظیمات .env ناقص است');

  const file = 'deployments/airdrop-amoy.json';
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(key, provider);
  const expectedToken = '0x473C3aEaa61266b03eC5F2Fea0dE683b83714EB2';
  const amount = ethers.utils.parseUnits('350', 18);
  const maxFee = ethers.utils.parseUnits('60', 'gwei');
  const priorityFee = ethers.utils.parseUnits('30', 'gwei');

  const token = new ethers.Contract(expectedToken, [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ], wallet);

  const drop = new ethers.Contract(record.airdropAddress, [
    'function token() view returns (address)',
    'function merkleRoot() view returns (bytes32)'
  ], provider);

  const net = await provider.getNetwork();
  if (net.chainId !== 80002) throw Error('شبکه Polygon Amoy نیست');
  if (record.funded) throw Error('فایل پروژه می‌گوید ایردراپ تأمین شده است');
  if (record.tokenAddress.toLowerCase() !== expectedToken.toLowerCase())
    throw Error('آدرس توکن در فایل پروژه نادرست است');
  if (wallet.address.toLowerCase() !== record.deployer.toLowerCase())
    throw Error('کیف پول با آدرس سازنده مطابقت ندارد');
  if ((await drop.token()).toLowerCase() !== expectedToken.toLowerCase())
    throw Error('توکن متصل به قرارداد ایردراپ مطابقت ندارد');
  if ((await drop.merkleRoot()).toLowerCase() !== record.merkleRoot.toLowerCase())
    throw Error('Merkle root مطابقت ندارد');
  if ((await provider.getCode(record.airdropAddress)) === '0x')
    throw Error('قرارداد ایردراپ در شبکه پیدا نشد');
  if (await token.symbol() !== 'HLT' || (await token.decimals()) !== 18)
    throw Error('مشخصات توکن HLT مورد انتظار نیست');
  if (record.totalAllocation !== amount.toString())
    throw Error('مجموع تخصیص فایل پروژه دقیقاً 350 HLT نیست');

  const [senderBalance, dropBalance, polBalance] = await Promise.all([
    token.balanceOf(wallet.address),
    token.balanceOf(record.airdropAddress),
    provider.getBalance(wallet.address)
  ]);

  if (senderBalance.lt(amount)) throw Error('موجودی HLT کافی نیست');
  if (!dropBalance.isZero())
    throw Error('قرارداد موجودی HLT دارد؛ قبل از ادامه بررسی لازم است');

  const request = await token.populateTransaction.transfer(
    record.airdropAddress, amount
  );
  const gas = await provider.estimateGas({
    ...request,
    from: wallet.address
  });
  const maxCost = gas.mul(maxFee);
  if (polBalance.lt(maxCost)) throw Error('موجودی POL برای کارمزد کافی نیست');

  console.log('\n--- بررسی نهایی ---');
  console.log('شبکه: Polygon Amoy (80002)');
  console.log('از:', wallet.address);
  console.log('به:', record.airdropAddress);
  console.log('مقدار: 350 HLT');
  console.log('موجودی POL:', ethers.utils.formatEther(polBalance));
  console.log('حداکثر کارمزد تخمینی:', ethers.utils.formatEther(maxCost), 'POL');
  console.log('\nبرای ارسال تراکنش این عبارت را دقیق وارد کن:');
  console.log('FUND 350 HLT TO AIRDROP');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const answer = await new Promise(resolve =>
    rl.question('تأیید: ', resolve)
  );
  rl.close();

  if (answer.trim() !== 'FUND 350 HLT TO AIRDROP') {
    console.log('لغو شد؛ تراکنشی ارسال نشد.');
    return;
  }

  const tx = await token.transfer(record.airdropAddress, amount, {
    gasLimit: gas.mul(120).div(100),
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: priorityFee
  });

  console.log('هش تراکنش:', tx.hash);
  console.log('در انتظار تأیید...');
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) throw Error('تراکنش موفق نبود');

  const finalBalance = await token.balanceOf(record.airdropAddress);
  if (finalBalance.lt(amount))
    throw Error('موجودی نهایی کمتر از مقدار مورد انتظار است');

  record.funded = true;
  record.fundingTransaction = tx.hash;
  record.fundedAmount = amount.toString();
  record.fundedAt = new Date().toISOString();

  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', {
    mode: 0o600
  });

  console.log('\nانتقال تأیید شد.');
  console.log('موجودی قرارداد:', ethers.utils.formatUnits(finalBalance, 18), 'HLT');
  console.log('تراکنش: https://amoy.polygonscan.com/tx/' + tx.hash);
}

main().catch(err => {
  console.error('\nخطا:', err.reason || err.message || err);
  process.exitCode = 1;
});
