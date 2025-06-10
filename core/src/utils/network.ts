import { isUndefined, noop } from './unit';

/**
 * Loads an SDK into the global window namespace.
 *
 * @see https://github.com/vime-js/vime/blob/master/packages/core/src/utils/network.ts
 */
export const loadSDK = <SDKType = unknown>(
  url: string,
  sdkGlobalVar: string,
  sdkReadyVar?: string,
  isLoaded: (sdk: SDKType) => boolean = () => true,
  loadScriptFn = loadScript,
): Promise<SDKType> => {
  const getGlobal = (key: keyof Window) => {
    if (!isUndefined(window[key])) return window[key];
    if (window['exports'] && window['exports'][key]) return window['exports'][key];
    if (window['module'] && window['module'].exports && window['module'].exports[key]) {
      return window['module'].exports[key];
    }
    return undefined;
  };

  const existingGlobal = getGlobal(sdkGlobalVar as keyof Window);

  if (existingGlobal && isLoaded(existingGlobal)) {
    return Promise.resolve(existingGlobal);
  }

  return new Promise<SDKType>((resolve, reject) => {
    if (!isUndefined(pendingSDKRequests[url])) {
      pendingSDKRequests[url].push({ resolve, reject });
      return;
    }

    pendingSDKRequests[url] = [{ resolve, reject }];

    const onLoaded = (sdk: SDKType) => {
      pendingSDKRequests[url].forEach((request) => request.resolve(sdk));
    };

    const onError = (e: Error) => {
      pendingSDKRequests[url].forEach((request) => {
        request.reject(e);
      });
      delete pendingSDKRequests[url];
      throw e;
    };

    if (!isUndefined(sdkReadyVar)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previousOnReady: () => void = window[sdkReadyVar as any] as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any)[sdkReadyVar as any] = function () {
        if (!isUndefined(previousOnReady)) previousOnReady();
        onLoaded(getGlobal(sdkGlobalVar as keyof Window));
      };
    }

    /**
     * ! PROBLEM
     * * Ao carregar o player a partir de um MFE comecei a tomar o erro 'Cannot read properties of undefined' no HlsJs.
     * * Descobri que ao carregar o HlsJs dinamicamente de dentro do MFE, mesmo com o .js adicionado a página corretamente
     * * o modulo se perdia e eu não conseguia mais acesso via window.Hls.
     * * Após pesquisa, entendi que ao fazer qualquer carregamento dinamico de .js partir de um MFE o contexto do módulo
     * * não é mais o window e sim o contexto do próprio MFE.
     * * Isso acontece porque o SingleSPA usa o System.js por baixo dos panos para carregar e descarregar os módulos,
     * * o System.js, por sua vez, cria um contexto para cada MFE e por isso, tudo que é carregado dinamicamente
     * * dentro do MFE fica dentro dele mesmo e não no window.
     *
     * * SOLUTION
     * * O SingleSPA carrega o System.js e ele fica pendurado no window, a idéia é carregar o .js utilizando esse mesmo System.js.
     * * Para isso, checo se o System.js existe e uso o método System.import para o carregamento do .js necessário
     */
    const System = window['System'];
    if (System && System.hasOwnProperty('import')) {
      System.import(url)
        .then((response) => onLoaded(response.default))
        .catch(onError);
    } else {
      loadScriptFn(
        url,
        () => {
          if (isUndefined(sdkReadyVar)) onLoaded(getGlobal(sdkGlobalVar as keyof Window));
        },
        onError
      );
    }
  });
};

export const loadScript = (
  src: string,
  onLoad: () => void,
  onError: (e: Error) => void = noop
): void => {
  const script = document.createElement('script');
  script.src = src;
  script.onload = onLoad;
  script.onerror = onError as any;
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode?.insertBefore(script, firstScriptTag);
};

export function loadDependency(url, globalVariable = '', force = false) {
  return new Promise((resolve, reject) => {
    if (window[globalVariable] === undefined || force) {
      loadScript(url, () => {
        resolve(window[globalVariable]);
      }, reject)
    } else {
      resolve(window[globalVariable]);
    }
  });
}



type PendingSDKRequest<SDKType = any> = {
  resolve: (value: SDKType) => void;
  reject: (reason: unknown) => void;
};

const pendingSDKRequests: Record<string, PendingSDKRequest[]> = {};
