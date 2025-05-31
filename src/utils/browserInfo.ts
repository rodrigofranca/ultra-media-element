// info.js
type BrowserInfo = {
  browser: string;
  browserVersion: string;
  browserMajorVersion: number | string;
};
type OSInfo = {
  os: string;
  osVersion: string;
  osMajorVersion: number | string;
  isSmartTv?: boolean;
};

const browsers = [
  { name: 'Chrome', regex: /Chrome\/([\d.]+)/ },
  { name: 'Firefox', regex: /Firefox\/([\d.]+)/ },
  { name: 'Edge', regex: /Edg\/([\d.]+)/ },
  { name: 'Safari', regex: /Version\/([\d.]+)/ },
  { name: 'Opera', regex: /OPR\/([\d.]+)/ },
  { name: 'IE', regex: /MSIE ([\d.]+)/ }
];

const osRegexes = [
  { name: 'Windows', regex: /Windows NT ([\d.]+)/ },
  { name: 'Mac OS X', regex: /Mac OS X ([\d_.]+)/ },
  { name: 'Android', regex: /Android ([\d.]+)/ },
  { name: 'iOS', regex: /OS (\d+)_(\d+)_?(\d+)?/ },
  { name: 'Tizen', regex: /Tizen (\d+)/ },
  { name: 'Web0S', regex: /Web0S/ }
];

const getBrowserInfo = () => {
  const userAgent = navigator?.userAgent || '';
  const browserData: BrowserInfo = {
    browser: '-',
    browserVersion: '-',
    browserMajorVersion: '-'
  };

  const match = browsers.find(({ regex }) => userAgent.match(regex));
  if (match) {
    browserData.browser = match.name;
    browserData.browserVersion = match.regex.exec(userAgent)?.[1] || '-';
    browserData.browserMajorVersion = parseInt(browserData.browserVersion.split('.')?.[0]);
  }

  return browserData;
};

const getOSInfo = () => {
  const osData: OSInfo = {
    os: '-',
    osVersion: '-',
    osMajorVersion: '-'
  };

  const userAgent = navigator?.userAgent || '';
  const match = osRegexes.find(({ regex }) => userAgent.match(regex));

  if (match) {
    osData.os = match.name;
    osData.osVersion = match.regex.exec(userAgent)?.[1]?.replace(/_/g, '.') || '-';
    osData.osMajorVersion = parseInt(osData.osVersion.split('.')[0]);
    osData.isSmartTv = osData.os.match(/Tizen|Web0S/i) !== null;

    if (osData.os === 'Windows') {
      (async () => {
        const ua = await (navigator as any)?.userAgentData?.getHighEntropyValues([
          'platformVersion'
        ]);
        if (ua && parseInt(ua.platformVersion) >= 14) {
          osData.osVersion = '11';
          osData.osMajorVersion = 11;
        }
      })();
    }
  }

  return osData;
};

// const _userAgent = navigator?.userAgent.toLowerCase() || '';
export const info = (() => {
  const browserInfo = getBrowserInfo();
  const osInfo = getOSInfo();
  return {
    ...browserInfo,
    ...osInfo,
    connection: (navigator as any)?.connection?.effectiveType,
    isIOS: osInfo.os.match(/iOS/i) !== null,
    isEdge: browserInfo.browser.match(/Edge/i) !== null,
    isSafari:
      browserInfo.browser.indexOf('Safari') > -1 &&
      osInfo.os.indexOf('Mac') > -1 &&
      browserInfo.browser.indexOf('Chrome') == -1
  };
})();

export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator?.userAgent || ''
);
