const availableQueryStrings = [
  'autoplay',
  'mediaId',
  'collectionId',
  'seasonAssetId',
  'streamId',
  'liveId',
  'customServer',
  'debug',
  'logger',
  'forcedfp',
  'playground',
  'dvr',
  'ads',
  'format',
  'profileId'
  // 'manifestServer',
  // 'fragmentServer',
] as const;

export type QueryStrings = (typeof availableQueryStrings)[number];

const has = (name: QueryStrings) => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.has(name);
};
const get = (name: QueryStrings, parse?: (value: any) => any) => {
  const searchParams = new URLSearchParams(location.search);
  const value = searchParams.get(name);
  if (parse && value) return parse(value);
  return value;
};
const getAll = (name: QueryStrings) => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.getAll(name);
};
const set = (name: QueryStrings, value: string) => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.set(name, value);
};
const append = (name: QueryStrings, value: string) => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.append(name, value);
};
const _delete = (name: QueryStrings) => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.delete(name);
};
const sort = () => {
  const searchParams = new URLSearchParams(location.search);
  return searchParams.sort();
};

export const appendSearchParams = (url: string, searchParams: { [key: string]: any }) => {
  const _url = new URL(url);
  const _searchParams = _url.searchParams;

  for (const key in searchParams) {
    if (Object.hasOwnProperty.call(searchParams, key) && searchParams[key]) {
      const value = searchParams[key];
      _searchParams.append(key, value.toString());
    }
  }

  return new URL(_url.origin + _url.pathname + `?${_searchParams.toString()}`).toString();
};

export const hasQueryStrings = (url: string, queryStrings: string[]) => {
  var urlObj = new URL(url);
  var searchParams = urlObj.searchParams;

  for (var i = 0; i < queryStrings.length; i++) {
    if (!searchParams.has(queryStrings[i])) {
      return false;
    }
  }
  return true;
};


export { append, get, set, has, getAll, _delete as delete, sort };

export default { append, get, set, has, getAll, delete: _delete, sort, hasQueryStrings, appendSearchParams }