const $ = (id) => document.getElementById(id);
const connectButton = $("connect");
const switchButton = $("switch");
const statusBox = $("status");
const languageButton = $("language");

const AMOY_CHAIN_ID = "0x13882";
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
    switchButton.disabled = true;
    setStatus(tr(
      "کیف پول سازگار پیدا نشد. اتصال اختیاری است.",
      "No compatible wallet found. Connecting is optional."
    ));
    return;
  }

  if (!currentAccount) {
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
    setStatus(
      tr("کیف پول: ", "Wallet: ") +
      shortAddress(currentAccount) +
      (chainId === AMOY_CHAIN_ID
        ? tr(" · شبکه آزمایشی Amoy", " · Amoy testnet")
        : tr(" · شبکه فعلی Amoy نیست", " · Not on Amoy"))
    );
  } catch {
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
