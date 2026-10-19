const $ = (id) => document.getElementById(id);
const connectButton = $("connect");
const switchButton = $("switch");
const statusBox = $("status");
const languageButton = $("language");
const claimButton = $("claim");

const AMOY_CHAIN_ID = "0x13882";
const HLT_READ_ONLY_PANEL_V1 = true;
const HLT_TOKEN_ADDRESS = "0x473C3aEaa61266b03eC5F2Fea0dE683b83714EB2";
const HLT_AIRDROP_ADDRESS = "0x3c2D98A0d1e6AcaA5Cc5B7A2066cdfD3A5337f0D";
const HLT_MERKLE_ROOT = "0x4d838f562710120ba590c815bc3962eb79c450dc8135cc502a2f0002fe870163";
const HLT_AIRDROP_API_URL = "https://hashlink-airdrop-api.reza22farokhi.workers.dev";
const HLT_CLAIM_DEADLINE = 1794801209;
const HLT_BALANCE_OF_SELECTOR = "0x70a08231";
const HLT_CLAIMED_SELECTOR = "0x73b2e80e";
const HLT_CLAIM_SELECTOR = "0x2f52ebb7";

function clearChainData(message = "—") {
  const ids = ["hlt-wallet-balance", "hlt-airdrop-balance", "hlt-claim-status"];
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
  }
}

function formatHLT(raw) {
  const value = BigInt(raw);
  const base = 10n ** 18n;
  const whole = (value / base).toLocaleString("en-US");
  const fraction = (value % base).toString().padStart(18, "0")
    .slice(0, 4).replace(/0+$/, "");
  return whole + (fraction ? "." + fraction : "") + " HLT";
}

async function readContract(address, data) {
  return window.ethereum.request({
    method: "eth_call",
    params: [{ to: address, data }, "latest"]
  });
}

async function updateChainData(account, requestId) {
  clearChainData("در حال خواندن…");
  try {
    const paddedAccount = account.toLowerCase().replace(/^0x/, "").padStart(64, "0");

    const [walletRaw, airdropRaw, claimedRaw] = await Promise.all([
      readContract(HLT_TOKEN_ADDRESS, HLT_BALANCE_OF_SELECTOR + paddedAccount),
      readContract(HLT_TOKEN_ADDRESS,
        HLT_BALANCE_OF_SELECTOR + HLT_AIRDROP_ADDRESS.toLowerCase().replace(/^0x/, "").padStart(64, "0")),
      readContract(HLT_AIRDROP_ADDRESS, HLT_CLAIMED_SELECTOR + paddedAccount)
    ]);

    if (requestId !== statusRequestId || account !== currentAccount) return;

    document.getElementById("hlt-wallet-balance").textContent = formatHLT(walletRaw);
    document.getElementById("hlt-airdrop-balance").textContent = formatHLT(airdropRaw);

    const claimed = BigInt(claimedRaw) !== 0n;
    document.getElementById("hlt-claim-status").textContent = claimed
      ? tr("این کیف پول قبلاً ایردراپ گرفته است.", "This wallet has already claimed.")
      : tr("این کیف پول هنوز ایردراپ نگرفته است.", "This wallet has not claimed yet.");
  } catch (error) {
    if (requestId !== statusRequestId) return;
    clearChainData(tr("خواندن اطلاعات ناموفق بود؛ شبکه و قراردادها را بررسی کن.", "Could not read data; check the network and contracts."));
    console.error("HLT read-only query failed:", error);
  }
}

const AMOY_NETWORK = {
  chainId: AMOY_CHAIN_ID,
  chainName: "Polygon Amoy Testnet",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com"],
  blockExplorerUrls: ["https://amoy.polygonscan.com/"]
};

let currentAccount = null;
let currentLanguage = "fa";
let statusRequestId = 0;

function tr(fa, en) {
  return currentLanguage === "fa" ? fa : en;
}

function shortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function setStatus(message) {
  statusBox.textContent = message;
}

async function updateWalletUI() {
  const requestId = ++statusRequestId;

  connectButton.textContent = currentAccount
    ? tr("کیف پول متصل است", "Wallet connected")
    : tr("اتصال کیف پول", "Connect wallet");

  if (!window.ethereum) {
    claimButton.disabled = true;
    switchButton.disabled = true;
    setStatus(tr(
      "کیف پول سازگار پیدا نشد. اتصال اختیاری است.",
      "No compatible wallet found. Connecting is optional."
    ));
    return;
  }

  if (!currentAccount) {
    claimButton.disabled = true;
    clearChainData();
    switchButton.disabled = true;
    setStatus(tr("کیف پول متصل نیست.", "Wallet not connected."));
    return;
  }

  try {
    const chainId = await window.ethereum.request({
      method: "eth_chainId"
    });

    if (requestId !== statusRequestId) return;

    switchButton.disabled = chainId === AMOY_CHAIN_ID;
    claimButton.disabled = chainId !== AMOY_CHAIN_ID;
    if (chainId !== AMOY_CHAIN_ID) clearChainData();
    setStatus(
      tr("کیف پول: ", "Wallet: ") +
      shortAddress(currentAccount) +
      (chainId === AMOY_CHAIN_ID
        ? tr(" · شبکه آزمایشی Amoy", " · Amoy testnet")
        : tr(" · شبکه فعلی Amoy نیست", " · Not on Amoy"))
    );
    if (chainId === AMOY_CHAIN_ID && currentAccount) {
      await updateChainData(currentAccount, requestId);
    }
  } catch {
    clearChainData();
    if (requestId !== statusRequestId) return;
    switchButton.disabled = true;
    setStatus(tr(
      "وضعیت شبکه قابل بررسی نیست.",
      "Unable to check network."
    ));
  }
}

function setLanguage(language) {
  currentLanguage = language;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

  document.querySelectorAll("[data-fa][data-en]").forEach(element => {
    element.innerHTML = element.dataset[language];
  });

  languageButton.textContent =
    language === "fa" ? "English" : "فارسی";

  updateWalletUI();
}

languageButton.addEventListener("click", () => {
  setLanguage(currentLanguage === "fa" ? "en" : "fa");
});


function encodeClaimCall(amount, proof) {
  const amountWord = BigInt(amount).toString(16).padStart(64, "0");
  const offsetWord = (64n).toString(16).padStart(64, "0");
  const lengthWord = BigInt(proof.length).toString(16).padStart(64, "0");
  const proofWords = proof.map(item => {
    if (typeof item !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item)) {
      throw new Error("ساختار proof نامعتبر است.");
    }
    return item.slice(2).toLowerCase();
  }).join("");
  return HLT_CLAIM_SELECTOR + amountWord + offsetWord + lengthWord + proofWords;
}

async function claimAirdrop() {
  if (!window.ethereum || !currentAccount) {
    setStatus(tr("ابتدا کیف پول را متصل کن.", "Connect a wallet first."));
    return;
  }

  claimButton.disabled = true;
  let submittedTxHash = null;
  try {
    const [chainId, accounts] = await Promise.all([
      window.ethereum.request({ method: "eth_chainId" }),
      window.ethereum.request({ method: "eth_accounts" })
    ]);

    if (chainId !== AMOY_CHAIN_ID) {
      throw new Error(tr("شبکه باید Polygon Amoy باشد.", "Switch to Polygon Amoy first."));
    }

    const account = accounts[0];
    if (!account || account.toLowerCase() !== currentAccount.toLowerCase()) {
      throw new Error(tr("حساب فعال کیف پول تغییر کرده است؛ دوباره متصل شو.", "The active wallet account changed. Reconnect."));
    }

    if (Math.floor(Date.now() / 1000) > HLT_CLAIM_DEADLINE) {
      throw new Error(tr("مهلت ایردراپ پایان یافته است.", "The airdrop claim deadline has passed."));
    }

    setStatus(tr(
      "در حال دریافت چالش امنیتی از API…",
      "Requesting a security challenge from the API…"
    ));

    const challengeResponse = await fetch(`${HLT_AIRDROP_API_URL}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account }),
      cache: "no-store"
    });

    let challenge;
    try {
      challenge = await challengeResponse.json();
    } catch {
      throw new Error("The API returned an invalid challenge response.");
    }
    if (!challengeResponse.ok || !challenge ||
        typeof challenge.nonce !== "string" ||
        typeof challenge.message !== "string" ||
        !challenge.message) {
      throw new Error(challenge?.error || "Could not obtain a wallet challenge.");
    }

    setStatus(tr(
      "درخواست امضای پیام مالکیت در کیف پول؛ این امضا تراکنش نیست و توکن جابه‌جا نمی‌کند.",
      "Sign the wallet-ownership message; this is not a transaction and does not move tokens."
    ));

    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [challenge.message, account]
    });

    const proofResponse = await fetch(`${HLT_AIRDROP_API_URL}/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: account,
        nonce: challenge.nonce,
        signature
      }),
      cache: "no-store"
    });

    let proofData;
    try {
      proofData = await proofResponse.json();
    } catch {
      throw new Error("The API returned an invalid proof response.");
    }

    if (!proofResponse.ok || !proofData) {
      throw new Error(proofData?.error || "The API could not verify this wallet.");
    }

    if (
      proofData.network !== "polygon-amoy" ||
      String(proofData.chainId) !== "80002" ||
      typeof proofData.tokenAddress !== "string" ||
      proofData.tokenAddress.toLowerCase() !== HLT_TOKEN_ADDRESS.toLowerCase() ||
      typeof proofData.airdropAddress !== "string" ||
      proofData.airdropAddress.toLowerCase() !== HLT_AIRDROP_ADDRESS.toLowerCase() ||
      typeof proofData.merkleRoot !== "string" ||
      proofData.merkleRoot.toLowerCase() !== HLT_MERKLE_ROOT.toLowerCase() ||
      typeof proofData.address !== "string" ||
      proofData.address.toLowerCase() !== account.toLowerCase() ||
      typeof proofData.amount !== "string" ||
      !/^\d+$/.test(proofData.amount) ||
      !Array.isArray(proofData.proof) ||
      !proofData.proof.every(item =>
        typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item)
      )
    ) {
      throw new Error(tr(
        "پاسخ API با شبکه، قرارداد یا کیف پول فعال مطابقت ندارد.",
        "The API response does not match the network, contract, or active wallet."
      ));
    }

    const recipient = {
      address: proofData.address,
      amount: proofData.amount,
      proof: proofData.proof
    };
    const amount = BigInt(recipient.amount);
    if (amount <= 0n) {
      throw new Error(tr("مبلغ ایردراپ نامعتبر است.", "Invalid airdrop allocation."));
    }

    const paddedAccount = account.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const [claimedRaw, airdropBalanceRaw] = await Promise.all([
      readContract(HLT_AIRDROP_ADDRESS, HLT_CLAIMED_SELECTOR + paddedAccount),
      readContract(HLT_TOKEN_ADDRESS,
        HLT_BALANCE_OF_SELECTOR +
        HLT_AIRDROP_ADDRESS.toLowerCase().replace(/^0x/, "").padStart(64, "0"))
    ]);

    if (BigInt(claimedRaw) !== 0n) {
      throw new Error(tr("این کیف پول قبلاً Claim کرده است.", "This wallet has already claimed."));
    }
    if (BigInt(airdropBalanceRaw) < amount) {
      throw new Error(tr("موجودی قرارداد برای این Claim کافی نیست.", "The airdrop contract has insufficient HLT."));
    }

    const txData = encodeClaimCall(recipient.amount, recipient.proof);

    setStatus(tr(
      "در حال شبیه‌سازی تراکنش؛ هنوز چیزی ارسال نشده است…",
      "Simulating transaction; nothing has been sent yet…"
    ));

    await window.ethereum.request({
      method: "eth_call",
      params: [{ from: account, to: HLT_AIRDROP_ADDRESS, data: txData }, "latest"]
    });

    if ((await window.ethereum.request({ method: "eth_chainId" })) !== AMOY_CHAIN_ID) {
      throw new Error(tr("شبکه تغییر کرده است؛ دوباره تلاش کن.", "The network changed. Please try again."));
    }

    setStatus(tr(
      "شبیه‌سازی موفق بود. MetaMask را بررسی و فقط در صورت تأیید خودت تراکنش را تأیید کن.",
      "Simulation succeeded. Review MetaMask and confirm only if you approve the transaction."
    ));

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: account,
        to: HLT_AIRDROP_ADDRESS,
        data: txData
      }]
    });
    submittedTxHash = txHash;

    setStatus(tr(
      "درخواست تراکنش به کیف پول ارسال شد. هش تراکنش: ",
      "Transaction submitted. Transaction hash: "
    ) + txHash);
  } catch (error) {
    const message = error?.message || "Unknown error";
    setStatus(tr("Claim انجام نشد: ", "Claim failed: ") + message);
    console.error("HLT claim failed:", error);
  } finally {
    try {
      await updateWalletUI();
    } catch (refreshError) {
      console.error("Wallet UI refresh failed:", refreshError);
    }

    if (submittedTxHash) {
      setStatus(tr(
        "تراکنش ارسال شده است؛ تأیید نهایی را در اکسپلورر بررسی کن. هش: ",
        "Transaction submitted; check the explorer for confirmation. Hash: "
      ) + submittedTxHash);
    }

    let chainId = null;
    try {
      if (window.ethereum) {
        chainId = await window.ethereum.request({ method: "eth_chainId" });
      }
    } catch (chainError) {
      console.error("Could not read wallet chain:", chainError);
    }

    claimButton.disabled = !currentAccount || chainId !== AMOY_CHAIN_ID;
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus(tr(
      "کیف پول سازگار پیدا نشد. می‌توانی بدون اتصال از سایت استفاده کنی.",
      "No compatible wallet detected. You can use the site without connecting."
    ));
    return;
  }

  connectButton.disabled = true;

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    currentAccount = accounts[0] || null;
    await updateWalletUI();
  } catch (error) {
    setStatus(
      tr("اتصال لغو شد یا ناموفق بود: ", "Connection failed: ") +
      (error?.message || "Unknown error")
    );
  } finally {
    connectButton.disabled = false;
  }
}

async function switchToAmoy() {
  if (!window.ethereum) return;

  switchButton.disabled = true;

  try {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: AMOY_CHAIN_ID }]
      });
    } catch (error) {
      if (error?.code !== 4902) throw error;

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [AMOY_NETWORK]
      });

      // پس از افزودن شبکه، انتخاب آن را نیز درخواست می‌کنیم.
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: AMOY_CHAIN_ID }]
      });
    }

    await updateWalletUI();
  } catch (error) {
    await updateWalletUI();
    setStatus(
      tr("تغییر شبکه انجام نشد: ", "Network switch failed: ") +
      (error?.message || "Unknown error")
    );
  }
}

claimButton.addEventListener("click", claimAirdrop);
connectButton.addEventListener("click", connectWallet);
switchButton.addEventListener("click", switchToAmoy);

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", accounts => {
    currentAccount = accounts[0] || null;
    updateWalletUI();
  });

  window.ethereum.on?.("chainChanged", () => {
    updateWalletUI();
  });

  // بازیابی حساب مجاز قبلی بدون نمایش درخواست مجوز جدید
  window.ethereum.request({ method: "eth_accounts" })
    .then(accounts => {
      currentAccount = accounts[0] || null;
      updateWalletUI();
    })
    .catch(() => updateWalletUI());
}

$("suggestion").addEventListener("submit", event => {
  event.preventDefault();

  const form = event.currentTarget;
  const project = form.elements.project.value.trim();
  const description = form.elements.description.value.trim();
  const result = $("form-status");

  result.hidden = false;

  if (!project || !description) {
    result.textContent = tr(
      "لطفاً نام پروژه و توضیح کوتاه را وارد کن.",
      "Please enter a project name and a short description."
    );
    return;
  }

  result.textContent = tr(
    `فرم نمایشی بررسی شد: «${project}». اطلاعات ذخیره یا ارسال نشده‌اند؛ اتصال بک‌اند هنوز انجام نشده است.`,
    `Demo form checked for "${project}". Nothing was saved or sent; backend integration is not yet available.`
  );
});

setLanguage("fa");
