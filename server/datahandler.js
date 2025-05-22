/* Libraries / Imports */
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-napi');

const platform = os.platform();
const cpuArchitecture = os.arch();
let unicodeType;
let sharedLibrary;

if (platform === 'win32') {
  unicodeType = ref.types.int16;
  sharedLibrary = path.join(__dirname, 'libraries', 'librdsparser.dll');
} else if (platform === 'linux') {
  unicodeType = ref.types.int32;
  sharedLibrary = path.join(__dirname, 'libraries', `librdsparser_${cpuArchitecture}.so`);
} else if (platform === 'darwin') {
  unicodeType = ref.types.int32;
  sharedLibrary = path.join(__dirname, 'libraries', 'librdsparser.dylib');
}

// Define array types for Unicode and error buffers
const UnicodeArray = ArrayType(unicodeType);
const ErrorArray = ArrayType(ref.types.uint8);

// Load the native library and map functions
const lib = ffi.Library(sharedLibrary, {
  'rdsparser_new': ['pointer', []],
  'rdsparser_free': ['void', ['pointer']],
  'rdsparser_clear': ['void', ['pointer']],
  'rdsparser_parse_string': ['bool', ['pointer', 'string']],
  'rdsparser_set_text_correction': ['bool', ['pointer', 'uint8', 'uint8', 'uint8']],
  'rdsparser_set_text_progressive': ['bool', ['pointer', 'uint8', 'bool']],
  'rdsparser_get_pi': ['int32', ['pointer']],
  'rdsparser_get_pty': ['int8', ['pointer']],
  'rdsparser_get_tp': ['int8', ['pointer']],
  'rdsparser_get_ta': ['int8', ['pointer']],
  'rdsparser_get_ms': ['int8', ['pointer']],
  'rdsparser_get_ecc': ['int16', ['pointer']],
  'rdsparser_get_country': ['int', ['pointer']],
  'rdsparser_get_ps': ['pointer', ['pointer']],
  'rdsparser_get_rt': ['pointer', ['pointer', 'int']],
  'rdsparser_get_ptyn': ['pointer', ['pointer']],
  'rdsparser_ct_get_year': ['uint16', ['pointer']],
  'rdsparser_ct_get_month': ['uint8', ['pointer']],
  'rdsparser_ct_get_day': ['uint8', ['pointer']],
  'rdsparser_ct_get_hour': ['uint8', ['pointer']],
  'rdsparser_ct_get_minute': ['uint8', ['pointer']],
  'rdsparser_ct_get_offset': ['int8', ['pointer']],
  'rdsparser_string_get_length': ['uint8', ['pointer']],
  'rdsparser_string_get_content': [UnicodeArray, ['pointer']],
  'rdsparser_string_get_errors': [ErrorArray, ['pointer']],
  // register callbacks
  'rdsparser_register_pi': ['void', ['pointer', 'pointer']],
  'rdsparser_register_pty': ['void', ['pointer', 'pointer']],
  'rdsparser_register_tp': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ta': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ms': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ecc': ['void', ['pointer', 'pointer']],
  'rdsparser_register_country': ['void', ['pointer', 'pointer']],
  'rdsparser_register_af': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ps': ['void', ['pointer', 'pointer']],
  'rdsparser_register_rt': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ptyn': ['void', ['pointer', 'pointer']],
  'rdsparser_register_ct': ['void', ['pointer', 'pointer']],
  'rdsparser_pty_lookup_short': ['string', ['int8', 'bool']],
  'rdsparser_pty_lookup_long': ['string', ['int8', 'bool']],
  'rdsparser_country_lookup_name': ['string', ['int']],
  'rdsparser_country_lookup_iso': ['string', ['int']],
});

/* Callback definitions using ffi-napi */
const callbacks = {
  pi: ffi.Callback('void', ['pointer', 'pointer'], (rds, userData) => {
    const val = lib.rdsparser_get_pi(rds);
    // console.log('PI: ' + val.toString(16).toUpperCase());
  }),
  // ... define other callbacks similarly ...
};

// Create parser instance and configure
let rds = lib.rdsparser_new();
lib.rdsparser_set_text_correction(rds, 0, 0, 2);
lib.rdsparser_set_text_correction(rds, 0, 1, 2);
lib.rdsparser_set_text_correction(rds, 1, 0, 2);
lib.rdsparser_set_text_correction(rds, 1, 1, 2);
lib.rdsparser_set_text_progressive(rds, 0, true);
lib.rdsparser_set_text_progressive(rds, 1, true);
Object.keys(callbacks).forEach(key => {
  lib[`rdsparser_register_${key}`](rds, callbacks[key]);
});

/* Helper to decode Unicode strings */
function decodeUnicode(ptr) {
  const length = lib.rdsparser_string_get_length(ptr);
  if (!length) return '';
  const buf = ptr.reinterpret(unicodeType.size * length);
  const arr = [];
  for (let i = 0; i < length; i++) {
    const code = unicodeType.get(buf, i * unicodeType.size);
    arr.push(code);
  }
  return String.fromCodePoint(...arr);
}

/* Helper to decode error array */
function decodeErrors(ptr) {
  const length = lib.rdsparser_string_get_length(ptr);
  if (!length) return '';
  const buf = ptr.reinterpret(ref.types.uint8.size * length);
  const errArr = [];
  for (let i = 0; i < length; i++) {
    errArr.push(buf.readUInt8(i));
  }
  return errArr.toString();
}

// Export handleData, showOnlineUsers, etc., and integrate the rest of your JS logic as before
module.exports = {
  // ... your functions and exports here ...
};
