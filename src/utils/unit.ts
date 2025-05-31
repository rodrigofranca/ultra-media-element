export type Constructor<T = Record<string, unknown>> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T;
  prototype: T;
};

/**
 * No-operation (noop).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const noop = (..._: unknown[]): void => {
  // ...
};

/**
 * Checks if `value` is `null`.
 *
 * @param value - The value to check.
 */
export const isNull = (value: unknown): value is null => value === null;

/**
 * Checks if `value` is `undefined`.
 *
 * @param value - The value to check.
 */
export const isUndefined = (value: unknown): value is undefined => typeof value === 'undefined';

/**
 * Checks if `value` is `null` or `undefined`.
 *
 * @param value - The value to check.
 */
export const isNil = (value: unknown): value is null | undefined =>
  isNull(value) || isUndefined(value);

/**
 * Returns the constructor of the given `value`.
 *
 * @param value - The value to return the constructor of.
 */
export const getConstructor = <T = unknown>(value: unknown): T | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  !isNil(value) ? (value as any).constructor : undefined;

/**
 * Checks if `value` is classified as a `Object` object.
 *
 * @param value - The value to check.
 */
export const isObject = (value: unknown): boolean => getConstructor(value) === Object;

/**
 * Checks if `value` is classified as a `Number` object.
 *
 * @param value - The value to check.
 */
export const isNumber = (value: unknown): value is number =>
  getConstructor(value) === Number && !Number.isNaN(value);

/**
 * Checks if `value` is classified as a `String` object.
 *
 * @param value - The value to check.
 */
export const isString = (value: unknown): value is string => getConstructor(value) === String;

/**
 * Checks if `value` is classified as a `Boolean` object.
 *
 * @param value - The value to check.
 */
export const isBoolean = (value: unknown): value is boolean => getConstructor(value) === Boolean;

/**
 * Checks if `value` is classified as a `Function` object.
 *
 * @param value - The value to check.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export const isFunction = (value: unknown): value is Function => getConstructor(value) === Function;

/**
 * Checks if `value` is classified as an `Array` object.
 *
 * @param value - The value to check.
 */
export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Checks if `value` is an instanceof the given `constructor`.
 *
 * @param value - The value to check.
 * @param constructor - The constructor to check against.
 */
export const isInstanceOf = (value: unknown, constructor: Constructor<unknown>): boolean =>
  Boolean(value && constructor && value instanceof constructor);

/**
 * Checks if the `value` prototype chain includes the given `object`.
 *
 * @param value - The value whose prototype chain to check.
 * @param object - The object to search for in the prototype chain.
 */
export const isPrototypeOf = (
  // eslint-disable-next-line @typescript-eslint/ban-types
  value: Object,
  object: Constructor<unknown>
): boolean => Boolean(value && object && Object.isPrototypeOf.call(object.prototype, value));

export const toPerc = (value: number, total: number) => Math.floor(100 * (value / total));

export const sortNumbers = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

export const generateUUID = () => {
  let uuid = '';
  const hexValues = '0123456789abcdef';

  for (let i = 0; i < 36; i++) {
    const randomIndex = Math.floor(Math.random() * 16);
    const currentHexValue = hexValues[randomIndex];

    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hexValues[(randomIndex & 0x3) | 0x8];
    } else {
      uuid += currentHexValue;
    }
  }

  return uuid;
};

export const minMax = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function isEmpty(obj) {
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
}