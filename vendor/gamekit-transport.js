// BLOOM GameKit 1:1 WebRTC transport, source 9dd41e95f8064dc6c96f057d66f35ca9e9d690b4, dist 10b27d8ea7f816586e41973d37d4bd2a01cc8755.
// All original code by bloom-gamekit. Regenerate with tools/vendor_transport.py.
var NumoriGameKitTransport = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // entry.mjs
  var entry_exports = {};
  __export(entry_exports, {
    createNostrRoom: () => createNostrRoom,
    createNostrSignaler: () => createNostrSignaler
  });

  // transport.mjs
  var NOW_MS = () => globalThis.performance?.now() ?? Date.now();
  function integer(value, name, min = 0, max = 4294967295) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(name);
    }
    return value;
  }
  function bytes(value, name = "bytes") {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`${name} must be Uint8Array or ArrayBuffer`);
  }
  var SIGNED = (x) => integer(x, "fixed-point result", -2147483648, 2147483647);
  var FIXED_POINT = Object.freeze({
    scale: 1024,
    fromNumber: (x) => SIGNED(Math.round(x * 1024)),
    toNumber: (x) => SIGNED(x) / 1024,
    add: (a, b) => SIGNED(SIGNED(a) + SIGNED(b)),
    sub: (a, b) => SIGNED(SIGNED(a) - SIGNED(b)),
    mul: (a, b) => {
      SIGNED(a);
      SIGNED(b);
      const PRODUCT = a * b;
      if (Number.isSafeInteger(PRODUCT)) {
        return SIGNED(Math.trunc(PRODUCT / 1024) || 0);
      }
      return SIGNED(Number(BigInt(a) * BigInt(b) / 1024n));
    },
    div: (a, b) => {
      if (SIGNED(b) === 0) {
        throw new RangeError("fixed-point division by zero");
      }
      return SIGNED(Math.trunc(SIGNED(a) * 1024 / b) || 0);
    }
  });
  var PROTOCOL_VERSION = 3;
  var CHUNK_SIZE = 16384;
  var DEFAULTS = {
    mode: "rollback",
    inputScheduling: "configured",
    inputSafetyMarginMs: 8,
    inputJitterMultiplier: 2,
    tickRate: 60,
    baseInputDelayTicks: 2,
    minInputDelayTicks: 0,
    maxInputDelayTicks: 8,
    rollbackWindowTicks: 12,
    stateHistorySize: 64,
    predictionPolicy: "hold",
    stallPolicy: "wait",
    tickDriftThreshold: 2,
    pacingPolicy: "hold",
    checksumInterval: 30,
    maxCatchupSteps: 4,
    adaptiveInputDelay: true,
    heartbeatMs: 100,
    adaptationIntervalMs: 1e3,
    maxSnapshotBytes: 4 * 1024 * 1024,
    maxHistoryBytes: 64 * 1024 * 1024,
    maxReplayBytes: 64 * 1024 * 1024,
    maxCommandBytes: 2048,
    maxPendingCommands: 256,
    maxQueuedBytes: 5 * 1024 * 1024,
    recoveryTimeoutMs: 1e4,
    maxRecoveryAttempts: 3,
    peerInterruptMs: 1e3,
    peerTimeoutMs: 1e4
  };
  var PROFILES = Object.freeze({
    action: Object.freeze({
      ...DEFAULTS
    }),
    rts: Object.freeze({
      ...DEFAULTS,
      tickRate: 20,
      baseInputDelayTicks: 4,
      maxInputDelayTicks: 12,
      rollbackWindowTicks: 6,
      stateHistorySize: 32,
      predictionPolicy: "neutral",
      checksumInterval: 20
    }),
    lockstep: Object.freeze({
      ...DEFAULTS,
      mode: "lockstep",
      tickRate: 20,
      baseInputDelayTicks: 4,
      maxInputDelayTicks: 20,
      rollbackWindowTicks: 0,
      checksumInterval: 20,
      stateHistorySize: 32,
      predictionPolicy: "neutral"
    })
  });
  var ENCODER = new TextEncoder();
  var DECODER = new TextDecoder("utf-8", {
    fatal: true
  });
  var TYPE = Object.freeze({
    HELLO: 1,
    INPUT: 2,
    CLOCK: 3,
    HASH: 4,
    REQUEST: 5,
    BEGIN: 6,
    CHUNK: 7,
    INPUT_RESERVATION: 8,
    INPUT_RESERVATION_ACK: 9
  });
  var HEADER = 12;
  var SNAP_CHUNK_BYTES = CHUNK_SIZE - HEADER - 8;
  var Writer = class {
    constructor(size = CHUNK_SIZE) {
      this.data = new Uint8Array(size);
      this.view = new DataView(this.data.buffer);
      this.offset = 0;
    }
    room(n) {
      if (this.offset + n > this.data.length) {
        throw new RangeError("packet capacity");
      }
    }
    u8(n) {
      this.room(1);
      this.view.setUint8(this.offset++, n);
    }
    u16(n) {
      this.room(2);
      this.view.setUint16(this.offset, n, true);
      this.offset += 2;
    }
    u32(n) {
      this.room(4);
      this.view.setUint32(this.offset, n, true);
      this.offset += 4;
    }
    i32(n) {
      this.room(4);
      this.view.setInt32(this.offset, n, true);
      this.offset += 4;
    }
    raw(b) {
      this.room(b.length);
      this.data.set(b, this.offset);
      this.offset += b.length;
    }
    finish() {
      return this.data.slice(0, this.offset);
    }
    reset() {
      this.offset = 0;
      return this;
    }
    usedBytes() {
      return this.data.subarray(0, this.offset);
    }
  };
  var PACKET_WRITER = new Writer();
  var WebRTCTransport = class {
    constructor({ inputChannel, controlChannel, highWaterMark = 262144, lowWaterMark = 65536 } = {}) {
      if (!controlChannel || typeof controlChannel.send !== "function") {
        throw new TypeError("controlChannel");
      }
      integer(highWaterMark, "highWaterMark", CHUNK_SIZE, 16 * 1024 * 1024);
      integer(lowWaterMark, "lowWaterMark", 0, highWaterMark);
      this.inputChannel = inputChannel ?? controlChannel;
      this.controlChannel = controlChannel;
      this.highWaterMark = highWaterMark;
      this.listeners = /* @__PURE__ */ new Set();
      this.statusListeners = /* @__PURE__ */ new Set();
      this.closed = false;
      this.connectionState = "connected";
      this._lastStatus = null;
      this.channels = [.../* @__PURE__ */ new Set([this.inputChannel, this.controlChannel])];
      this._onMessage = async (event) => {
        if (this.closed) {
          return;
        }
        let data = event.data;
        if (typeof Blob !== "undefined" && data instanceof Blob) {
          if (data.size > CHUNK_SIZE) {
            return;
          }
          data = await data.arrayBuffer();
        }
        if (this.closed) {
          return;
        }
        try {
          const B = bytes(data);
          if (B.length > CHUNK_SIZE) {
            return;
          }
          for (const LISTENER of this.listeners) {
            LISTENER(B.slice());
          }
        } catch {
        }
      };
      for (const CHANNEL of this.channels) {
        CHANNEL.binaryType = "arraybuffer";
        CHANNEL.bufferedAmountLowThreshold = lowWaterMark;
        CHANNEL.addEventListener("message", this._onMessage);
        CHANNEL.addEventListener("open", this._onStatus = this._onStatus ?? (() => this._notifyStatus()));
        CHANNEL.addEventListener("close", this._onStatus);
        CHANNEL.addEventListener(
          "error",
          this._onChannelError = this._onChannelError ?? (() => {
            this.connectionState = "failed";
            this._notifyStatus();
          })
        );
      }
    }
    get state() {
      if (this.closed || this.connectionState === "closed" || this.channels.some((c) => c.readyState === "closed" || c.readyState === "closing")) {
        return "closed";
      }
      if (this.connectionState === "failed") {
        return "failed";
      }
      if (this.connectionState === "disconnected") {
        return "interrupted";
      }
      return this.channels.every((c) => c.readyState === "open") ? "open" : "connecting";
    }
    _notifyStatus() {
      const STATE = this.state;
      if (STATE === this._lastStatus) {
        return;
      }
      this._lastStatus = STATE;
      for (const LISTENER of this.statusListeners) {
        try {
          LISTENER(STATE);
        } catch {
        }
      }
    }
    setConnectionState(state) {
      this.connectionState = state;
      this._notifyStatus();
    }
    subscribeStatus(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("status subscriber");
      }
      this.statusListeners.add(listener);
      return () => this.statusListeners.delete(listener);
    }
    get bufferedAmount() {
      return this.channels.reduce((n, c) => n + c.bufferedAmount, 0);
    }
    send(data) {
      const B = bytes(data);
      if (B.length > CHUNK_SIZE) {
        throw new RangeError("DataChannel chunk size");
      }
      const TYPE_LOCAL = B.length >= HEADER ? B[5] : 0;
      const CHANNEL = TYPE_LOCAL === TYPE.INPUT || TYPE_LOCAL === TYPE.CLOCK ? this.inputChannel : this.controlChannel;
      if (this.closed || CHANNEL.readyState !== "open" || this.bufferedAmount + B.length > this.highWaterMark) {
        return false;
      }
      try {
        CHANNEL.send(B);
        return true;
      } catch (error) {
        if (error.name === "OperationError" || error.name === "InvalidStateError") {
          return false;
        }
        throw error;
      }
    }
    subscribe(handler) {
      if (this.closed || typeof handler !== "function") {
        throw new TypeError("transport subscriber");
      }
      this.listeners.add(handler);
      return () => this.listeners.delete(handler);
    }
    close() {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this._notifyStatus();
      for (const CHANNEL of this.channels) {
        CHANNEL.removeEventListener("message", this._onMessage);
        CHANNEL.removeEventListener("open", this._onStatus);
        CHANNEL.removeEventListener("close", this._onStatus);
        CHANNEL.removeEventListener("error", this._onChannelError);
        CHANNEL.close();
      }
      this.listeners.clear();
      this.statusListeners.clear();
    }
  };
  var DEFAULT_ICE = Object.freeze([
    {
      urls: "stun:stun.l.google.com:19302"
    }
  ]);
  var NOSTR_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var NOSTR_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var NOSTR_GENERATOR = [
    0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
    1n
  ];
  var NOSTR_INFINITY = [0n, 1n, 0n];
  var NOSTR_ENCODER = new TextEncoder();
  function nostrMod(nostrValue, nostrModulus = NOSTR_FIELD) {
    const NOSTR_REMAINDER = nostrValue % nostrModulus;
    return NOSTR_REMAINDER < 0n ? NOSTR_REMAINDER + nostrModulus : NOSTR_REMAINDER;
  }
  function nostrPow(nostrBase, nostrExponent) {
    let nostrResult = 1n;
    nostrBase = nostrMod(nostrBase);
    while (nostrExponent > 0n) {
      if (nostrExponent & 1n) {
        nostrResult = nostrMod(nostrResult * nostrBase);
      }
      nostrBase = nostrMod(nostrBase * nostrBase);
      nostrExponent >>= 1n;
    }
    return nostrResult;
  }
  function nostrDouble(nostrPoint) {
    const [NOSTR_X, NOSTR_Y, NOSTR_Z] = nostrPoint;
    if (NOSTR_Z === 0n || NOSTR_Y === 0n) {
      return NOSTR_INFINITY;
    }
    const NOSTR_A = nostrMod(NOSTR_X * NOSTR_X);
    const NOSTR_B = nostrMod(NOSTR_Y * NOSTR_Y);
    const NOSTR_C = nostrMod(NOSTR_B * NOSTR_B);
    const NOSTR_D = nostrMod(2n * (nostrMod((NOSTR_X + NOSTR_B) ** 2n) - NOSTR_A - NOSTR_C));
    const NOSTR_E = nostrMod(3n * NOSTR_A);
    const NOSTR_NEXT_X = nostrMod(NOSTR_E * NOSTR_E - 2n * NOSTR_D);
    return [
      NOSTR_NEXT_X,
      nostrMod(NOSTR_E * (NOSTR_D - NOSTR_NEXT_X) - 8n * NOSTR_C),
      nostrMod(2n * NOSTR_Y * NOSTR_Z)
    ];
  }
  function nostrAdd(nostrLeft, nostrRight) {
    if (nostrLeft[2] === 0n) {
      return nostrRight;
    }
    if (nostrRight[2] === 0n) {
      return nostrLeft;
    }
    const [NOSTR_X1, NOSTR_Y1, NOSTR_Z1] = nostrLeft;
    const [NOSTR_X2, NOSTR_Y2, NOSTR_Z2] = nostrRight;
    const NOSTR_Z1_SQUARED = nostrMod(NOSTR_Z1 * NOSTR_Z1);
    const NOSTR_Z2_SQUARED = nostrMod(NOSTR_Z2 * NOSTR_Z2);
    const NOSTR_U1 = nostrMod(NOSTR_X1 * NOSTR_Z2_SQUARED);
    const NOSTR_U2 = nostrMod(NOSTR_X2 * NOSTR_Z1_SQUARED);
    const NOSTR_S1 = nostrMod(NOSTR_Y1 * NOSTR_Z2_SQUARED * NOSTR_Z2);
    const NOSTR_S2 = nostrMod(NOSTR_Y2 * NOSTR_Z1_SQUARED * NOSTR_Z1);
    if (NOSTR_U1 === NOSTR_U2) {
      return NOSTR_S1 === NOSTR_S2 ? nostrDouble(nostrLeft) : NOSTR_INFINITY;
    }
    const NOSTR_H = nostrMod(NOSTR_U2 - NOSTR_U1);
    const NOSTR_I = nostrMod(4n * NOSTR_H * NOSTR_H);
    const NOSTR_J = nostrMod(NOSTR_H * NOSTR_I);
    const NOSTR_R = nostrMod(2n * (NOSTR_S2 - NOSTR_S1));
    const NOSTR_V = nostrMod(NOSTR_U1 * NOSTR_I);
    const NOSTR_NEXT_X = nostrMod(NOSTR_R * NOSTR_R - NOSTR_J - 2n * NOSTR_V);
    return [
      NOSTR_NEXT_X,
      nostrMod(NOSTR_R * (NOSTR_V - NOSTR_NEXT_X) - 2n * NOSTR_S1 * NOSTR_J),
      nostrMod(((NOSTR_Z1 + NOSTR_Z2) ** 2n - NOSTR_Z1_SQUARED - NOSTR_Z2_SQUARED) * NOSTR_H)
    ];
  }
  function nostrMultiply(nostrScalar, nostrPoint = NOSTR_GENERATOR) {
    let nostrResult = NOSTR_INFINITY;
    while (nostrScalar > 0n) {
      if (nostrScalar & 1n) {
        nostrResult = nostrAdd(nostrResult, nostrPoint);
      }
      nostrPoint = nostrDouble(nostrPoint);
      nostrScalar >>= 1n;
    }
    return nostrResult;
  }
  function nostrAffine(nostrPoint) {
    if (nostrPoint[2] === 0n) {
      return null;
    }
    const NOSTR_INVERSE = nostrPow(nostrPoint[2], NOSTR_FIELD - 2n);
    const NOSTR_INVERSE_SQUARED = nostrMod(NOSTR_INVERSE * NOSTR_INVERSE);
    return [
      nostrMod(nostrPoint[0] * NOSTR_INVERSE_SQUARED),
      nostrMod(nostrPoint[1] * NOSTR_INVERSE_SQUARED * NOSTR_INVERSE)
    ];
  }
  function nostrLiftX(nostrX) {
    if (nostrX >= NOSTR_FIELD) {
      return null;
    }
    const NOSTR_C = nostrMod(nostrX ** 3n + 7n);
    const NOSTR_Y = nostrPow(NOSTR_C, (NOSTR_FIELD + 1n) / 4n);
    if (nostrMod(NOSTR_Y * NOSTR_Y) !== NOSTR_C) {
      return null;
    }
    return [nostrX, NOSTR_Y & 1n ? NOSTR_FIELD - NOSTR_Y : NOSTR_Y, 1n];
  }
  function nostrRequireBytes(nostrValue, nostrLength, nostrName) {
    if (!(nostrValue instanceof Uint8Array) || nostrValue.length !== nostrLength) {
      throw new TypeError(`${nostrName} must be a ${nostrLength}-byte Uint8Array`);
    }
    return new Uint8Array(nostrValue);
  }
  function nostrBytesToNumber(nostrBytes) {
    let nostrValue = 0n;
    for (const NOSTR_BYTE of nostrBytes) {
      nostrValue = nostrValue << 8n | BigInt(NOSTR_BYTE);
    }
    return nostrValue;
  }
  function nostrNumberToBytes(nostrValue) {
    const NOSTR_BYTES = new Uint8Array(32);
    for (let nostrIndex = 31; nostrIndex >= 0; nostrIndex--) {
      NOSTR_BYTES[nostrIndex] = Number(nostrValue & 255n);
      nostrValue >>= 8n;
    }
    return NOSTR_BYTES;
  }
  function nostrToHex(nostrBytes) {
    return Array.from(nostrBytes, (nostrByte) => nostrByte.toString(16).padStart(2, "0")).join("");
  }
  function nostrFromHex(nostrHex) {
    return Uint8Array.from(nostrHex.match(/../g), (nostrByte) => parseInt(nostrByte, 16));
  }
  function nostrConcat(...nostrParts) {
    const NOSTR_BYTES = new Uint8Array(nostrParts.reduce((nostrSize, nostrPart) => nostrSize + nostrPart.length, 0));
    let nostrOffset = 0;
    for (const NOSTR_PART of nostrParts) {
      NOSTR_BYTES.set(NOSTR_PART, nostrOffset);
      nostrOffset += NOSTR_PART.length;
    }
    return NOSTR_BYTES;
  }
  function nostrRequireCrypto(nostrCryptoImpl, nostrRandom = false) {
    if (!nostrCryptoImpl?.subtle || typeof nostrCryptoImpl.subtle.digest !== "function" || nostrRandom && typeof nostrCryptoImpl.getRandomValues !== "function") {
      throw new Error("Nostr signaling requires WebCrypto SHA-256 and secure randomness (use HTTPS)");
    }
  }
  async function nostrHash(nostrBytes, nostrCryptoImpl) {
    nostrRequireCrypto(nostrCryptoImpl);
    return new Uint8Array(await nostrCryptoImpl.subtle.digest("SHA-256", nostrBytes));
  }
  async function nostrTaggedHash(nostrTag, nostrBytes, nostrCryptoImpl) {
    const NOSTR_TAG_HASH = await nostrHash(NOSTR_ENCODER.encode(nostrTag), nostrCryptoImpl);
    return nostrHash(nostrConcat(NOSTR_TAG_HASH, NOSTR_TAG_HASH, nostrBytes), nostrCryptoImpl);
  }
  function nostrPublicKey(nostrSecret) {
    const NOSTR_SECRET_COPY = nostrRequireBytes(nostrSecret, 32, "secret");
    try {
      const NOSTR_SCALAR = nostrBytesToNumber(NOSTR_SECRET_COPY);
      if (NOSTR_SCALAR === 0n || NOSTR_SCALAR >= NOSTR_ORDER) {
        throw new RangeError("Invalid secp256k1 secret");
      }
      return nostrNumberToBytes(nostrAffine(nostrMultiply(NOSTR_SCALAR))[0]);
    } finally {
      NOSTR_SECRET_COPY.fill(0);
    }
  }
  async function nostrVerify(nostrSignature, nostrMessage, nostrPublic, nostrCryptoImpl) {
    if (!(nostrSignature instanceof Uint8Array) || nostrSignature.length !== 64 || !(nostrMessage instanceof Uint8Array) || nostrMessage.length !== 32 || !(nostrPublic instanceof Uint8Array) || nostrPublic.length !== 32) {
      return false;
    }
    const NOSTR_SIGNATURE_COPY = new Uint8Array(nostrSignature);
    const NOSTR_MESSAGE_COPY = new Uint8Array(nostrMessage);
    const NOSTR_PUBLIC_COPY = new Uint8Array(nostrPublic);
    const NOSTR_POINT = nostrLiftX(nostrBytesToNumber(NOSTR_PUBLIC_COPY));
    const NOSTR_R = nostrBytesToNumber(NOSTR_SIGNATURE_COPY.subarray(0, 32));
    const NOSTR_S = nostrBytesToNumber(NOSTR_SIGNATURE_COPY.subarray(32));
    if (!NOSTR_POINT || NOSTR_R >= NOSTR_FIELD || NOSTR_S >= NOSTR_ORDER) {
      return false;
    }
    const NOSTR_CHALLENGE = nostrBytesToNumber(
      await nostrTaggedHash(
        "BIP0340/challenge",
        nostrConcat(NOSTR_SIGNATURE_COPY.subarray(0, 32), NOSTR_PUBLIC_COPY, NOSTR_MESSAGE_COPY),
        nostrCryptoImpl
      )
    ) % NOSTR_ORDER;
    const NOSTR_RESULT = nostrAffine(
      nostrAdd(
        nostrMultiply(NOSTR_S),
        nostrMultiply(NOSTR_CHALLENGE, [NOSTR_POINT[0], nostrMod(-NOSTR_POINT[1]), 1n])
      )
    );
    return NOSTR_RESULT !== null && (NOSTR_RESULT[1] & 1n) === 0n && NOSTR_RESULT[0] === NOSTR_R;
  }
  async function nostrSign(nostrMessage, nostrSecret, nostrAuxiliary, nostrCryptoImpl) {
    const NOSTR_MESSAGE_COPY = nostrRequireBytes(nostrMessage, 32, "message");
    const NOSTR_AUXILIARY_COPY = nostrRequireBytes(nostrAuxiliary, 32, "auxiliary randomness");
    const NOSTR_SECRET_COPY = nostrRequireBytes(nostrSecret, 32, "secret");
    let nostrMaskedSecret;
    try {
      const NOSTR_SCALAR = nostrBytesToNumber(NOSTR_SECRET_COPY);
      if (NOSTR_SCALAR === 0n || NOSTR_SCALAR >= NOSTR_ORDER) {
        throw new RangeError("Invalid secp256k1 secret");
      }
      const NOSTR_POINT = nostrAffine(nostrMultiply(NOSTR_SCALAR));
      const NOSTR_NORMALIZED_SECRET = NOSTR_POINT[1] & 1n ? NOSTR_ORDER - NOSTR_SCALAR : NOSTR_SCALAR;
      const NOSTR_PUBLIC = nostrNumberToBytes(NOSTR_POINT[0]);
      const NOSTR_AUXILIARY_HASH = await nostrTaggedHash("BIP0340/aux", NOSTR_AUXILIARY_COPY, nostrCryptoImpl);
      nostrMaskedSecret = nostrNumberToBytes(NOSTR_NORMALIZED_SECRET);
      for (let nostrIndex = 0; nostrIndex < 32; nostrIndex++) {
        nostrMaskedSecret[nostrIndex] ^= NOSTR_AUXILIARY_HASH[nostrIndex];
      }
      const NOSTR_NONCE = nostrBytesToNumber(
        await nostrTaggedHash(
          "BIP0340/nonce",
          nostrConcat(nostrMaskedSecret, NOSTR_PUBLIC, NOSTR_MESSAGE_COPY),
          nostrCryptoImpl
        )
      ) % NOSTR_ORDER;
      if (NOSTR_NONCE === 0n) {
        throw new Error("BIP340 nonce generation failed");
      }
      const NOSTR_NONCE_POINT = nostrAffine(nostrMultiply(NOSTR_NONCE));
      const NOSTR_NORMALIZED_NONCE = NOSTR_NONCE_POINT[1] & 1n ? NOSTR_ORDER - NOSTR_NONCE : NOSTR_NONCE;
      const NOSTR_R = nostrNumberToBytes(NOSTR_NONCE_POINT[0]);
      const NOSTR_CHALLENGE = nostrBytesToNumber(
        await nostrTaggedHash(
          "BIP0340/challenge",
          nostrConcat(NOSTR_R, NOSTR_PUBLIC, NOSTR_MESSAGE_COPY),
          nostrCryptoImpl
        )
      ) % NOSTR_ORDER;
      const NOSTR_SIGNATURE = nostrConcat(
        NOSTR_R,
        nostrNumberToBytes(
          nostrMod(NOSTR_NORMALIZED_NONCE + NOSTR_CHALLENGE * NOSTR_NORMALIZED_SECRET, NOSTR_ORDER)
        )
      );
      if (!await nostrVerify(NOSTR_SIGNATURE, NOSTR_MESSAGE_COPY, NOSTR_PUBLIC, nostrCryptoImpl)) {
        throw new Error("BIP340 signature self-check failed");
      }
      return NOSTR_SIGNATURE;
    } finally {
      NOSTR_SECRET_COPY.fill(0);
      NOSTR_AUXILIARY_COPY.fill(0);
      nostrMaskedSecret?.fill(0);
    }
  }
  var NOSTR_CRYPTO = Object.freeze({
    publicKey: nostrPublicKey,
    sign: (nostrMessage, nostrSecret, nostrAuxiliary) => nostrSign(nostrMessage, nostrSecret, nostrAuxiliary, globalThis.crypto),
    verify: (nostrSignature, nostrMessage, nostrPublic) => nostrVerify(nostrSignature, nostrMessage, nostrPublic, globalThis.crypto)
  });
  var NOSTR_HEX32 = /^[0-9a-f]{64}$/;
  var NOSTR_HEX64 = /^[0-9a-f]{128}$/;
  var NOSTR_SIGNAL_TYPES = /* @__PURE__ */ new Set(["discover", "presence", "offer", "answer", "ice", "bye", "group"]);
  var NOSTR_CONTENT_LIMIT = 128 * 1024;
  var NOSTR_FRESH_SECONDS = 120;
  var NOSTR_FUTURE_SECONDS = 30;
  function nostrIsSignalMessage(nostrMessage) {
    return nostrMessage !== null && typeof nostrMessage === "object" && !Array.isArray(nostrMessage) && Object.prototype.hasOwnProperty.call(nostrMessage, "type") && NOSTR_SIGNAL_TYPES.has(nostrMessage.type);
  }
  function nostrListen(nostrSocket, nostrType, nostrHandler) {
    if (typeof nostrSocket.addEventListener === "function") {
      nostrSocket.addEventListener(nostrType, nostrHandler);
      return () => nostrSocket.removeEventListener(nostrType, nostrHandler);
    }
    const NOSTR_PROPERTY = `on${nostrType}`;
    nostrSocket[NOSTR_PROPERTY] = nostrHandler;
    return () => {
      if (nostrSocket[NOSTR_PROPERTY] === nostrHandler) {
        nostrSocket[NOSTR_PROPERTY] = null;
      }
    };
  }
  async function createNostrSignaler({
    room,
    namespace = "rollback-netcode",
    relays = ["wss://relay.primal.net", "wss://relay.damus.io"],
    timeoutMs = 1e4,
    onStatus = () => {
    },
    WebSocketImpl: webSocketImpl = globalThis.WebSocket,
    cryptoImpl = globalThis.crypto,
    signal,
    publishIntervalMs = 500,
    maxVerificationsPerSecond = 16,
    verificationBurst = 8,
    identity
  } = {}) {
    if (signal?.aborted) {
      throw new Error("Nostr signaler aborted");
    }
    if (typeof room !== "string" || !/^\d{4}$/.test(room)) {
      throw new TypeError("room must contain exactly four ASCII digits");
    }
    if (typeof namespace !== "string" || namespace.trim().length === 0 || NOSTR_ENCODER.encode(namespace).length > 128) {
      throw new TypeError("namespace must be a nonempty string of at most 128 UTF-8 bytes");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 12e4) {
      throw new RangeError("timeoutMs must be greater than zero and at most 120000");
    }
    integer(publishIntervalMs, "publishIntervalMs", 0, 1e4);
    integer(maxVerificationsPerSecond, "maxVerificationsPerSecond", 1, 1024);
    integer(verificationBurst, "verificationBurst", 1, 32);
    if (typeof webSocketImpl !== "function") {
      throw new Error("Nostr signaling requires WebSocket support");
    }
    if (typeof onStatus !== "function") {
      throw new TypeError("onStatus must be a function");
    }
    nostrRequireCrypto(cryptoImpl, true);
    if (!Array.isArray(relays) || relays.length === 0 || relays.length > 16) {
      throw new TypeError("relays must contain between 1 and 16 WebSocket URLs");
    }
    const NOSTR_URLS = [
      ...new Set(
        relays.map((nostrRelay) => {
          if (typeof nostrRelay !== "string") {
            throw new TypeError("Relay URLs must be strings");
          }
          const NOSTR_URL = new URL(nostrRelay);
          if (!["ws:", "wss:"].includes(NOSTR_URL.protocol) || NOSTR_URL.username || NOSTR_URL.password || NOSTR_URL.hash) {
            throw new TypeError("Relays must be ws:// or wss:// URLs without credentials or fragments");
          }
          return NOSTR_URL.href;
        })
      )
    ];
    const NOSTR_RANDOM = (nostrLength) => cryptoImpl.getRandomValues(new Uint8Array(nostrLength));
    if (identity && (!NOSTR_HEX32.test(identity.id) || typeof identity.sign !== "function" || typeof identity.close !== "function")) {
      throw new TypeError("Nostr identity capability");
    }
    const NOSTR_SECRET = new Uint8Array(32);
    let nostrSecretReady = !!identity;
    for (let nostrAttempt = 0; !nostrSecretReady && nostrAttempt < 16; nostrAttempt++) {
      NOSTR_SECRET.set(NOSTR_RANDOM(32));
      const NOSTR_VALUE = nostrBytesToNumber(NOSTR_SECRET);
      if (NOSTR_VALUE > 0n && NOSTR_VALUE < NOSTR_ORDER) {
        nostrSecretReady = true;
        break;
      }
    }
    if (!nostrSecretReady) {
      NOSTR_SECRET.fill(0);
      throw new Error("Secure random secret generation failed");
    }
    const NOSTR_ID = identity?.id ?? nostrToHex(nostrPublicKey(NOSTR_SECRET));
    const NOSTR_ROOM_TAG = `${namespace}:${room}`;
    const NOSTR_SUBSCRIPTION = `rn-${nostrToHex(NOSTR_RANDOM(16))}`;
    const NOSTR_LISTENERS = /* @__PURE__ */ new Set();
    const NOSTR_BACKLOG = [];
    const NOSTR_SEEN = /* @__PURE__ */ new Map();
    const NOSTR_VERIFYING = /* @__PURE__ */ new Set();
    const NOSTR_PENDING = /* @__PURE__ */ new Map();
    const NOSTR_STATES = [];
    let verificationTokens = verificationBurst;
    let verificationAt = NOW_MS();
    const VERIFICATION_METRICS = {
      attempted: 0,
      verified: 0,
      throttled: 0,
      totalVerificationMs: 0,
      maxVerificationMs: 0
    };
    let nostrClosed = false;
    let nostrSending = 0;
    let nostrSendTail = Promise.resolve();
    let nostrLastPublication = -Infinity;
    const NOSTR_WAITERS = /* @__PURE__ */ new Map();
    let nostrHasSubscriber = false;
    let nostrReadyResolve;
    let nostrReadyReject;
    let nostrInitializationSettled = false;
    const NOSTR_READY = new Promise((nostrResolve, nostrReject) => {
      nostrReadyResolve = nostrResolve;
      nostrReadyReject = nostrReject;
    });
    const NOSTR_STATUS = (nostrStatusName, nostrRelay, nostrMessage) => {
      if (nostrClosed && nostrStatusName !== "closed") {
        return;
      }
      try {
        onStatus({
          type: "signaler",
          transport: "nostr",
          status: nostrStatusName,
          ...nostrRelay ? {
            relay: nostrRelay
          } : {},
          ...nostrMessage ? {
            message: String(nostrMessage)
          } : {}
        });
      } catch {
      }
    };
    function nostrFinishPublication(nostrEventId, nostrError) {
      const NOSTR_PUBLICATION = NOSTR_PENDING.get(nostrEventId);
      if (!NOSTR_PUBLICATION) {
        return;
      }
      clearTimeout(NOSTR_PUBLICATION.timer);
      NOSTR_PENDING.delete(nostrEventId);
      if (nostrError) {
        NOSTR_PUBLICATION.reject(nostrError);
      } else {
        NOSTR_PUBLICATION.resolve();
      }
    }
    function nostrPublicationFailure(nostrState, nostrEventId, nostrReason) {
      const NOSTR_PUBLICATION = NOSTR_PENDING.get(nostrEventId);
      if (!NOSTR_PUBLICATION || !NOSTR_PUBLICATION.remaining.delete(nostrState)) {
        return;
      }
      NOSTR_PUBLICATION.failures.push(`${nostrState.url}: ${nostrReason}`);
      if (NOSTR_PUBLICATION.remaining.size === 0 && !NOSTR_STATES.some((nostrRelay) => !nostrRelay.failed && !nostrRelay.ready)) {
        nostrFinishPublication(
          nostrEventId,
          new Error(`No Nostr relay accepted the event: ${NOSTR_PUBLICATION.failures.join("; ")}`)
        );
      }
    }
    function nostrFailRelay(nostrState, nostrReason) {
      if (nostrState.failed || nostrClosed) {
        return;
      }
      nostrState.failed = true;
      nostrState.ready = false;
      clearTimeout(nostrState.timer);
      for (const NOSTR_REMOVE of nostrState.remove) {
        NOSTR_REMOVE();
      }
      try {
        nostrState.socket?.close();
      } catch {
      }
      for (const NOSTR_EVENT_ID of NOSTR_PENDING.keys()) {
        nostrPublicationFailure(nostrState, NOSTR_EVENT_ID, nostrReason);
      }
      NOSTR_STATUS("error", nostrState.url, nostrReason);
      if (!nostrInitializationSettled && NOSTR_STATES.length === NOSTR_URLS.length && NOSTR_STATES.every((nostrRelay) => nostrRelay.failed)) {
        nostrInitializationSettled = true;
        nostrReadyReject(new Error(`No Nostr relay became ready: ${nostrReason}`));
      }
    }
    function nostrDeliver(nostrEnvelope) {
      if (nostrClosed) {
        return;
      }
      if (!nostrHasSubscriber) {
        if (NOSTR_BACKLOG.length === 32) {
          NOSTR_BACKLOG.shift();
        }
        NOSTR_BACKLOG.push(nostrEnvelope);
        return;
      }
      for (const NOSTR_HANDLER of [...NOSTR_LISTENERS]) {
        if (nostrClosed) {
          break;
        }
        try {
          const NOSTR_RESULT = NOSTR_HANDLER(nostrEnvelope);
          if (NOSTR_RESULT && typeof NOSTR_RESULT.then === "function") {
            Promise.resolve(NOSTR_RESULT).catch(
              (nostrError) => NOSTR_STATUS("error", null, nostrError?.message || "Signaling subscriber failed")
            );
          }
        } catch (nostrError) {
          NOSTR_STATUS("error", null, nostrError?.message || "Signaling subscriber failed");
        }
      }
    }
    async function nostrReceive(nostrEvent) {
      if (nostrClosed || !nostrEvent || typeof nostrEvent !== "object" || Array.isArray(nostrEvent) || typeof nostrEvent.id !== "string" || typeof nostrEvent.pubkey !== "string" || typeof nostrEvent.sig !== "string" || !NOSTR_HEX32.test(nostrEvent.id) || !NOSTR_HEX32.test(nostrEvent.pubkey) || !NOSTR_HEX64.test(nostrEvent.sig) || nostrEvent.pubkey === NOSTR_ID || nostrEvent.kind !== 20078 || !Number.isSafeInteger(nostrEvent.created_at) || typeof nostrEvent.content !== "string" || nostrEvent.content.length > NOSTR_CONTENT_LIMIT || !Array.isArray(nostrEvent.tags) || nostrEvent.tags.length > 16 || NOSTR_VERIFYING.size >= 32) {
        return;
      }
      const NOSTR_NOW = Date.now();
      const NOSTR_NOW_SECONDS = Math.floor(NOSTR_NOW / 1e3);
      if (nostrEvent.created_at < NOSTR_NOW_SECONDS - NOSTR_FRESH_SECONDS || nostrEvent.created_at > NOSTR_NOW_SECONDS + NOSTR_FUTURE_SECONDS || NOSTR_ENCODER.encode(nostrEvent.content).length > NOSTR_CONTENT_LIMIT) {
        return;
      }
      for (const [NOSTR_SEEN_ID, NOSTR_EXPIRY] of NOSTR_SEEN) {
        if (NOSTR_EXPIRY > NOSTR_NOW) {
          break;
        }
        NOSTR_SEEN.delete(NOSTR_SEEN_ID);
      }
      if (NOSTR_SEEN.has(nostrEvent.id) || NOSTR_VERIFYING.has(nostrEvent.id)) {
        return;
      }
      if (!nostrEvent.tags.every(
        (nostrTag) => Array.isArray(nostrTag) && nostrTag.length > 0 && nostrTag.length <= 4 && nostrTag.every(
          (nostrValue) => typeof nostrValue === "string" && NOSTR_ENCODER.encode(nostrValue).length <= 256
        )
      )) {
        return;
      }
      const NOSTR_ROOM_TAGS = nostrEvent.tags.filter((nostrTag) => nostrTag[0] === "d");
      const NOSTR_RECIPIENT_TAGS = nostrEvent.tags.filter((nostrTag) => nostrTag[0] === "p");
      if (NOSTR_ROOM_TAGS.length !== 1 || NOSTR_ROOM_TAGS[0][1] !== NOSTR_ROOM_TAG) {
        return;
      }
      let nostrContent;
      try {
        nostrContent = JSON.parse(nostrEvent.content);
      } catch {
        return;
      }
      if (!nostrContent || nostrContent.v !== 1 || nostrContent.namespace !== namespace || nostrContent.room !== room || nostrContent.from !== nostrEvent.pubkey || typeof nostrContent.nonce !== "string" || !/^[0-9a-f]{32}$/.test(nostrContent.nonce) || nostrContent.to !== "*" && nostrContent.to !== NOSTR_ID || !nostrIsSignalMessage(nostrContent.message)) {
        return;
      }
      if (nostrContent.to === "*" ? NOSTR_RECIPIENT_TAGS.length !== 0 : NOSTR_RECIPIENT_TAGS.length !== 1 || NOSTR_RECIPIENT_TAGS[0][1] !== nostrContent.to) {
        return;
      }
      const MEASURED_NOW = NOW_MS();
      verificationTokens = Math.min(
        verificationBurst,
        verificationTokens + Math.max(0, MEASURED_NOW - verificationAt) * maxVerificationsPerSecond / 1e3
      );
      verificationAt = MEASURED_NOW;
      if (verificationTokens < 1) {
        VERIFICATION_METRICS.throttled++;
        return;
      }
      verificationTokens--;
      VERIFICATION_METRICS.attempted++;
      NOSTR_VERIFYING.add(nostrEvent.id);
      try {
        const NOSTR_HASH_BYTES = await nostrHash(
          NOSTR_ENCODER.encode(
            JSON.stringify([
              0,
              nostrEvent.pubkey,
              nostrEvent.created_at,
              nostrEvent.kind,
              nostrEvent.tags,
              nostrEvent.content
            ])
          ),
          cryptoImpl
        );
        if (nostrToHex(NOSTR_HASH_BYTES) !== nostrEvent.id || !await nostrVerify(
          nostrFromHex(nostrEvent.sig),
          NOSTR_HASH_BYTES,
          nostrFromHex(nostrEvent.pubkey),
          cryptoImpl
        ) || nostrClosed) {
          return;
        }
        if (NOSTR_SEEN.size >= 2048) {
          NOSTR_SEEN.delete(NOSTR_SEEN.keys().next().value);
        }
        NOSTR_SEEN.set(nostrEvent.id, NOSTR_NOW + 3e5);
        VERIFICATION_METRICS.verified++;
        nostrDeliver({
          from: nostrContent.from,
          to: nostrContent.to,
          message: nostrContent.message
        });
      } catch (nostrError) {
        NOSTR_STATUS("error", null, nostrError?.message || "Nostr verification failed");
      } finally {
        NOSTR_VERIFYING.delete(nostrEvent.id);
        const ELAPSED = NOW_MS() - MEASURED_NOW;
        VERIFICATION_METRICS.totalVerificationMs += ELAPSED;
        VERIFICATION_METRICS.maxVerificationMs = Math.max(VERIFICATION_METRICS.maxVerificationMs, ELAPSED);
      }
    }
    function nostrHandleMessage(nostrState, nostrData) {
      if (nostrClosed || nostrState.failed || typeof nostrData !== "string" || nostrData.length > 1024 * 1024) {
        return;
      }
      let nostrFrame;
      try {
        nostrFrame = JSON.parse(nostrData);
      } catch {
        return;
      }
      if (!Array.isArray(nostrFrame)) {
        return;
      }
      if (nostrFrame[0] === "EOSE" && nostrFrame.length === 2 && nostrFrame[1] === NOSTR_SUBSCRIPTION && nostrState.requested) {
        if (nostrState.ready) {
          return;
        }
        nostrState.ready = true;
        clearTimeout(nostrState.timer);
        NOSTR_STATUS("connected", nostrState.url);
        if (!nostrInitializationSettled) {
          nostrInitializationSettled = true;
          nostrReadyResolve();
        }
        for (const NOSTR_PUBLICATION of NOSTR_PENDING.values()) {
          if (!NOSTR_PUBLICATION.attempted.has(nostrState)) {
            NOSTR_PUBLICATION.attempted.add(nostrState);
            NOSTR_PUBLICATION.remaining.add(nostrState);
            try {
              nostrState.socket.send(NOSTR_PUBLICATION.frame);
            } catch (nostrError) {
              nostrFailRelay(nostrState, nostrError?.message || "Fallback publication failed");
            }
          }
        }
      } else if (nostrFrame[0] === "EVENT" && nostrFrame.length === 3 && nostrFrame[1] === NOSTR_SUBSCRIPTION && nostrState.requested) {
        void nostrReceive(nostrFrame[2]);
      } else if (nostrFrame[0] === "OK" && nostrFrame.length === 4 && typeof nostrFrame[1] === "string" && typeof nostrFrame[2] === "boolean" && typeof nostrFrame[3] === "string") {
        const NOSTR_PUBLICATION = NOSTR_PENDING.get(nostrFrame[1]);
        if (!NOSTR_PUBLICATION?.remaining.has(nostrState)) {
          return;
        }
        if (nostrFrame[2]) {
          nostrFinishPublication(nostrFrame[1]);
          NOSTR_STATUS("published", nostrState.url);
        } else {
          nostrFailRelay(nostrState, nostrFrame[3].slice(0, 256) || "Relay rejected the event");
        }
      } else if (nostrFrame[0] === "CLOSED" && nostrFrame.length === 3 && nostrFrame[1] === NOSTR_SUBSCRIPTION && typeof nostrFrame[2] === "string") {
        nostrFailRelay(nostrState, `Relay ended the signaling subscription: ${nostrFrame[2].slice(0, 256)}`);
      } else if (nostrFrame[0] === "NOTICE" && typeof nostrFrame[1] === "string") {
        NOSTR_STATUS("notice", nostrState.url, nostrFrame[1].slice(0, 256));
      }
    }
    function nostrClose() {
      if (nostrClosed) {
        return;
      }
      nostrClosed = true;
      signal?.removeEventListener("abort", nostrClose);
      for (const [NOSTR_TIMER, NOSTR_REJECT] of NOSTR_WAITERS) {
        clearTimeout(NOSTR_TIMER);
        NOSTR_REJECT(new Error("Nostr signaler closed"));
      }
      NOSTR_WAITERS.clear();
      for (const NOSTR_STATE of NOSTR_STATES) {
        clearTimeout(NOSTR_STATE.timer);
        if (NOSTR_STATE.socket?.readyState === 1 && NOSTR_STATE.requested) {
          try {
            NOSTR_STATE.socket.send(JSON.stringify(["CLOSE", NOSTR_SUBSCRIPTION]));
          } catch {
          }
        }
        for (const NOSTR_REMOVE of NOSTR_STATE.remove) {
          NOSTR_REMOVE();
        }
        try {
          NOSTR_STATE.socket?.close();
        } catch {
        }
        NOSTR_STATE.ready = false;
      }
      for (const NOSTR_EVENT_ID of NOSTR_PENDING.keys()) {
        nostrFinishPublication(NOSTR_EVENT_ID, new Error("Nostr signaler closed"));
      }
      if (!nostrInitializationSettled) {
        nostrInitializationSettled = true;
        nostrReadyReject(new Error("Nostr signaler closed"));
      }
      NOSTR_SECRET.fill(0);
      identity?.close();
      NOSTR_LISTENERS.clear();
      NOSTR_BACKLOG.length = 0;
      NOSTR_SEEN.clear();
      NOSTR_VERIFYING.clear();
      NOSTR_STATUS("closed");
    }
    signal?.addEventListener("abort", nostrClose, {
      once: true
    });
    for (const NOSTR_URL of NOSTR_URLS) {
      if (nostrClosed) {
        break;
      }
      const NOSTR_STATE = {
        url: NOSTR_URL,
        socket: null,
        ready: false,
        requested: false,
        failed: false,
        remove: [],
        timer: null
      };
      NOSTR_STATES.push(NOSTR_STATE);
      NOSTR_STATUS("connecting", NOSTR_URL);
      if (nostrClosed) {
        break;
      }
      try {
        const NOSTR_SOCKET = NOSTR_STATE.socket = new webSocketImpl(NOSTR_URL);
        if (nostrClosed) {
          try {
            NOSTR_SOCKET.close();
          } catch {
          }
          break;
        }
        NOSTR_STATE.timer = setTimeout(
          () => nostrFailRelay(NOSTR_STATE, "Nostr connection/subscription timed out"),
          timeoutMs
        );
        const NOSTR_OPEN = () => {
          if (nostrClosed || NOSTR_STATE.failed || NOSTR_STATE.requested) {
            return;
          }
          NOSTR_STATE.requested = true;
          try {
            NOSTR_SOCKET.send(
              JSON.stringify([
                "REQ",
                NOSTR_SUBSCRIPTION,
                {
                  kinds: [20078],
                  "#d": [NOSTR_ROOM_TAG],
                  since: Math.floor(Date.now() / 1e3) - NOSTR_FRESH_SECONDS,
                  limit: 0
                }
              ])
            );
          } catch (nostrError) {
            nostrFailRelay(NOSTR_STATE, nostrError?.message || "Nostr subscription failed");
          }
        };
        NOSTR_STATE.remove.push(
          nostrListen(NOSTR_SOCKET, "open", NOSTR_OPEN),
          nostrListen(NOSTR_SOCKET, "message", (nostrEvent) => nostrHandleMessage(NOSTR_STATE, nostrEvent.data)),
          nostrListen(NOSTR_SOCKET, "error", () => nostrFailRelay(NOSTR_STATE, "Nostr WebSocket error")),
          nostrListen(NOSTR_SOCKET, "close", () => nostrFailRelay(NOSTR_STATE, "Nostr relay disconnected"))
        );
        if (NOSTR_SOCKET.readyState === 1) {
          NOSTR_OPEN();
        }
      } catch (nostrError) {
        nostrFailRelay(NOSTR_STATE, nostrError?.message || "Nostr connection failed");
      }
    }
    try {
      await NOSTR_READY;
    } catch (nostrError) {
      nostrClose();
      throw nostrError;
    }
    return {
      id: NOSTR_ID,
      room,
      get metrics() {
        return {
          ...VERIFICATION_METRICS
        };
      },
      async send(nostrTo, nostrMessage) {
        if (nostrClosed) {
          throw new Error("Nostr signaler closed");
        }
        if (nostrTo !== "*" && (typeof nostrTo !== "string" || !NOSTR_HEX32.test(nostrTo))) {
          throw new TypeError("Nostr recipient must be a lowercase public key or *");
        }
        if (!nostrIsSignalMessage(nostrMessage)) {
          throw new TypeError(
            "Nostr carries discovery, presence, offer, answer, ice, bye and group signaling only"
          );
        }
        if (nostrSending >= 64) {
          throw new Error("Too many pending Nostr publications");
        }
        if (!NOSTR_STATES.some(
          (nostrState) => nostrState.ready && !nostrState.failed && nostrState.socket.readyState === 1
        )) {
          throw new Error("No live Nostr relays");
        }
        nostrSending++;
        const NOSTR_PREVIOUS = nostrSendTail;
        let nostrUnlock;
        nostrSendTail = new Promise((nostrResolve) => {
          nostrUnlock = nostrResolve;
        });
        try {
          let nostrContent;
          try {
            nostrContent = JSON.stringify({
              v: 1,
              namespace,
              room,
              from: NOSTR_ID,
              to: nostrTo,
              nonce: nostrToHex(NOSTR_RANDOM(16)),
              message: nostrMessage
            });
          } catch {
            throw new TypeError("Nostr signaling message must be JSON serializable");
          }
          if (NOSTR_ENCODER.encode(nostrContent).length > NOSTR_CONTENT_LIMIT) {
            throw new RangeError("Nostr signaling content exceeds 128 KiB");
          }
          if (!nostrIsSignalMessage(JSON.parse(nostrContent).message)) {
            throw new TypeError("Nostr signaling message serialization changed its type");
          }
          await NOSTR_PREVIOUS;
          if (nostrClosed) {
            throw new Error("Nostr signaler closed");
          }
          const NOSTR_WAIT = publishIntervalMs - (Date.now() - nostrLastPublication);
          if (NOSTR_WAIT > 0) {
            await new Promise((nostrResolve, nostrReject) => {
              const NOSTR_TIMER = setTimeout(() => {
                NOSTR_WAITERS.delete(NOSTR_TIMER);
                nostrResolve();
              }, NOSTR_WAIT);
              NOSTR_WAITERS.set(NOSTR_TIMER, nostrReject);
            });
          }
          if (nostrClosed) {
            throw new Error("Nostr signaler closed");
          }
          const NOSTR_EVENT = {
            pubkey: NOSTR_ID,
            created_at: Math.floor(Date.now() / 1e3),
            kind: 20078,
            tags: [["d", NOSTR_ROOM_TAG], ...nostrTo === "*" ? [] : [["p", nostrTo]]],
            content: nostrContent
          };
          const NOSTR_HASH_BYTES = await nostrHash(
            NOSTR_ENCODER.encode(
              JSON.stringify([
                0,
                NOSTR_ID,
                NOSTR_EVENT.created_at,
                NOSTR_EVENT.kind,
                NOSTR_EVENT.tags,
                nostrContent
              ])
            ),
            cryptoImpl
          );
          if (nostrClosed) {
            throw new Error("Nostr signaler closed");
          }
          const NOSTR_AUXILIARY = NOSTR_RANDOM(32);
          try {
            NOSTR_EVENT.sig = nostrToHex(
              await (identity ? identity.sign(NOSTR_HASH_BYTES, NOSTR_AUXILIARY, cryptoImpl) : nostrSign(NOSTR_HASH_BYTES, NOSTR_SECRET, NOSTR_AUXILIARY, cryptoImpl))
            );
          } finally {
            NOSTR_AUXILIARY.fill(0);
          }
          NOSTR_EVENT.id = nostrToHex(NOSTR_HASH_BYTES);
          if (nostrClosed) {
            throw new Error("Nostr signaler closed");
          }
          const NOSTR_AVAILABLE = NOSTR_STATES.filter(
            (nostrState) => nostrState.ready && !nostrState.failed && nostrState.socket.readyState === 1
          );
          if (NOSTR_AVAILABLE.length === 0) {
            throw new Error("No live Nostr relays");
          }
          const NOSTR_FRAME = JSON.stringify(["EVENT", NOSTR_EVENT]);
          nostrLastPublication = Date.now();
          await new Promise((nostrResolve, nostrReject) => {
            const NOSTR_PUBLICATION = {
              resolve: nostrResolve,
              reject: nostrReject,
              remaining: new Set(NOSTR_AVAILABLE),
              attempted: new Set(NOSTR_AVAILABLE),
              frame: NOSTR_FRAME,
              failures: [],
              timer: null
            };
            NOSTR_PENDING.set(NOSTR_EVENT.id, NOSTR_PUBLICATION);
            NOSTR_PUBLICATION.timer = setTimeout(
              () => nostrFinishPublication(
                NOSTR_EVENT.id,
                new Error("Nostr publication timed out without a positive relay OK")
              ),
              timeoutMs
            );
            for (const NOSTR_STATE of NOSTR_AVAILABLE) {
              if (nostrClosed) {
                break;
              }
              try {
                NOSTR_STATE.socket.send(NOSTR_FRAME);
              } catch (nostrError) {
                nostrFailRelay(NOSTR_STATE, nostrError?.message || "Nostr publication failed");
              }
            }
          });
        } finally {
          await NOSTR_PREVIOUS;
          nostrSending--;
          nostrUnlock();
        }
      },
      subscribe(nostrHandler) {
        if (nostrClosed) {
          throw new Error("Nostr signaler closed");
        }
        if (typeof nostrHandler !== "function") {
          throw new TypeError("Signaling subscriber must be a function");
        }
        NOSTR_LISTENERS.add(nostrHandler);
        if (!nostrHasSubscriber) {
          nostrHasSubscriber = true;
          const NOSTR_QUEUED = NOSTR_BACKLOG.splice(0);
          for (const NOSTR_ENVELOPE of NOSTR_QUEUED) {
            nostrDeliver(NOSTR_ENVELOPE);
          }
        }
        return () => NOSTR_LISTENERS.delete(nostrHandler);
      },
      close: nostrClose
    };
  }
  var APP_MESSAGE_LIMIT = 256 * 1024 - 1024;
  var APP_HIGH_WATER = 512 * 1024;
  var APP_LOW_WATER = 128 * 1024;
  var APP_QUEUE_LIMIT = 8 * 1024 * 1024;
  function createRoomChannels({ onError, onSendFailure }) {
    const NETCODE_LISTENERS = /* @__PURE__ */ new Set();
    const APP_LISTENERS = /* @__PURE__ */ new Set();
    const STATUS_LISTENERS = /* @__PURE__ */ new Set();
    let state = "connecting";
    let netcode = null;
    let unsubscribeNetcode = null;
    let appChannel = null;
    let queue = [];
    let queuedBytes = 0;
    let closed = false;
    function listen(set, listener, name) {
      if (typeof listener !== "function") {
        throw new TypeError(name);
      }
      if (closed) {
        return () => {
        };
      }
      set.add(listener);
      return () => set.delete(listener);
    }
    function deliver(set, data, code) {
      let first = true;
      for (const LISTENER of [...set]) {
        try {
          LISTENER(first ? data : data.slice());
        } catch (error) {
          onError(code, error);
        }
        first = false;
      }
    }
    function flush() {
      const CHANNEL = appChannel;
      while (CHANNEL && queue.length && CHANNEL.readyState === "open" && CHANNEL.bufferedAmount < APP_HIGH_WATER) {
        const FRAME = queue.shift();
        queuedBytes -= FRAME.length;
        try {
          CHANNEL.send(FRAME);
        } catch (error) {
          onError("send-failed", error);
          onSendFailure();
          return;
        }
      }
    }
    function dropQueue() {
      queue = [];
      queuedBytes = 0;
    }
    const TRANSPORT = {
      get state() {
        return state;
      },
      get bufferedAmount() {
        return netcode?.bufferedAmount ?? 0;
      },
      send(data) {
        return netcode ? netcode.send(data) : false;
      },
      subscribe: (listener) => listen(NETCODE_LISTENERS, listener, "transport subscriber"),
      subscribeStatus: (listener) => listen(STATUS_LISTENERS, listener, "status subscriber")
    };
    const APP = {
      get bufferedAmount() {
        return (appChannel?.bufferedAmount ?? 0) + queuedBytes;
      },
      send(data) {
        const FRAME = bytes(data, "app message");
        if (FRAME.length > APP_MESSAGE_LIMIT) {
          throw new RangeError("app message size");
        }
        const CHANNEL = appChannel;
        if (!CHANNEL || CHANNEL.readyState !== "open") {
          return false;
        }
        if (queue.length || CHANNEL.bufferedAmount >= APP_HIGH_WATER) {
          if (queuedBytes + FRAME.length > APP_QUEUE_LIMIT) {
            onError("send-queue-overflow", new RangeError("app send queue overflow"));
            return false;
          }
          queue.push(FRAME.slice());
          queuedBytes += FRAME.length;
          return true;
        }
        try {
          CHANNEL.send(FRAME);
          return true;
        } catch (error) {
          onError("send-failed", error);
          onSendFailure();
          return false;
        }
      },
      subscribe: (listener) => listen(APP_LISTENERS, listener, "app subscriber")
    };
    return {
      transport: TRANSPORT,
      app: APP,
      /** 열린 연결의 세 채널을 창구에 연결합니다. 이전 연결은 먼저 `detach`되어 있어야 합니다. */
      attach({ inputs, control, app }) {
        const CARRIER = new WebRTCTransport({ inputChannel: inputs, controlChannel: control });
        netcode = CARRIER;
        unsubscribeNetcode = CARRIER.subscribe((packet) => deliver(NETCODE_LISTENERS, packet, "listener"));
        app.binaryType = "arraybuffer";
        app.bufferedAmountLowThreshold = APP_LOW_WATER;
        app.onbufferedamountlow = flush;
        app.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > APP_MESSAGE_LIMIT) {
            onError("app-frame", new TypeError("app frames must be binary and at most " + APP_MESSAGE_LIMIT));
            return;
          }
          deliver(APP_LISTENERS, new Uint8Array(event.data), "listener");
        };
        appChannel = app;
      },
      /** 세 채널을 닫고 송신 큐를 버립니다. 구독자는 남깁니다. */
      detach() {
        unsubscribeNetcode?.();
        unsubscribeNetcode = null;
        netcode?.close();
        netcode = null;
        if (appChannel) {
          appChannel.onbufferedamountlow = appChannel.onmessage = null;
          appChannel.close();
          appChannel = null;
        }
        dropQueue();
      },
      setState(next) {
        if (next === state) {
          return;
        }
        state = next;
        for (const LISTENER of [...STATUS_LISTENERS]) {
          try {
            LISTENER(next);
          } catch (error) {
            onError("listener", error);
          }
        }
      },
      close() {
        closed = true;
        NETCODE_LISTENERS.clear();
        APP_LISTENERS.clear();
        STATUS_LISTENERS.clear();
      }
    };
  }
  var WIRE_SUFFIX = ":room-v2";
  var WATCH_MS = 1e3;
  var ICE_BATCH_MS = 100;
  var ICE_BATCH_LIMIT = 64;
  var ICE_BUFFER_LIMIT = 128;
  var SDP_LIMIT = 100 * 1024;
  var SESSION_ID = /^[0-9a-f]{32}$/;
  var CHANNEL_LABELS = ["inputs", "control", "app"];
  function randomHex(length) {
    return nostrToHex(globalThis.crypto.getRandomValues(new Uint8Array(length)));
  }
  function createMemoryIdentity() {
    const SECRET = new Uint8Array(32);
    let valid = false;
    for (let attempt = 0; attempt < 16 && !valid; attempt++) {
      globalThis.crypto.getRandomValues(SECRET);
      const VALUE = nostrBytesToNumber(SECRET);
      valid = VALUE > 0n && VALUE < NOSTR_ORDER;
    }
    if (!valid) {
      throw new Error("Secure random secret generation failed");
    }
    const ID = nostrToHex(nostrPublicKey(SECRET));
    let released = false;
    return {
      id: ID,
      // 전달자가 닫힐 때 부르는 close는 키를 지우지 않습니다. 키는 방이 닫힐 때만 지웁니다.
      capability: () => ({
        id: ID,
        sign(hash, auxiliary, cryptoImpl) {
          if (released) {
            throw new Error("room identity released");
          }
          return nostrSign(hash, SECRET, auxiliary, cryptoImpl);
        },
        close() {
        }
      }),
      release() {
        released = true;
        SECRET.fill(0);
      }
    };
  }
  function deferred() {
    const RESULT = {};
    RESULT.promise = new Promise((resolve, reject) => {
      RESULT.resolve = resolve;
      RESULT.reject = reject;
    });
    RESULT.promise.catch(() => {
    });
    return RESULT;
  }
  function description(value, type) {
    return value !== null && typeof value === "object" && value.type === type && typeof value.sdp === "string" && value.sdp.length <= SDP_LIMIT;
  }
  var IS_SERIAL = (value) => Number.isSafeInteger(value) && value >= 1;
  async function createNostrRoom({
    role,
    room,
    namespace = "rollback-netcode",
    version,
    relays,
    rtcConfig = { iceServers: DEFAULT_ICE },
    timeoutMs = 6e4,
    reconnectTimeoutMs = 6e4,
    peerTimeoutMs = 8e3,
    retryMs = 1e3,
    disconnectGraceMs = 2500,
    collisionCheckMs = 1200,
    onStatus = () => {
    },
    signal,
    signalerFactory = createNostrSignaler
  } = {}) {
    if (!["host", "join"].includes(role)) {
      throw new TypeError("room role");
    }
    if (typeof version !== "string" || version.length < 1 || version.length > 64) {
      throw new TypeError("room version must be a string of 1 to 64 characters");
    }
    integer(timeoutMs, "timeoutMs", 1, 36e5);
    integer(reconnectTimeoutMs, "reconnectTimeoutMs", 1, 36e5);
    integer(peerTimeoutMs, "peerTimeoutMs", 100, 12e4);
    integer(retryMs, "retryMs", 10, 1e4);
    integer(disconnectGraceMs, "disconnectGraceMs", 0, 6e4);
    integer(collisionCheckMs, "collisionCheckMs", 0, 1e4);
    if (typeof namespace !== "string" || !namespace.trim() || NOSTR_ENCODER.encode(namespace + WIRE_SUFFIX).length > 128) {
      throw new TypeError("room namespace");
    }
    if (typeof onStatus !== "function" || typeof signalerFactory !== "function") {
      throw new TypeError("room adapter factories");
    }
    if (typeof globalThis.RTCPeerConnection !== "function" || rtcConfig === null || typeof rtcConfig !== "object") {
      throw new TypeError("WebRTC capability and rtcConfig object required");
    }
    if (signal?.aborted) {
      throw new Error("room aborted");
    }
    if (!room && role === "host") {
      room = String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1e4).padStart(4, "0");
    }
    if (!/^\d{4}$/.test(room ?? "")) {
      throw new TypeError("four-digit room");
    }
    new globalThis.RTCPeerConnection(rtcConfig).close();
    const NAMESPACE = namespace + WIRE_SUFFIX;
    const HOST = role === "host";
    const IDENTITY = createMemoryIdentity();
    const SELF = IDENTITY.id;
    const CONTROLLER = new AbortController();
    const LISTENERS = /* @__PURE__ */ new Set();
    const INFLIGHT = /* @__PURE__ */ new Map();
    const HELLO = { version, protocol: PROTOCOL_VERSION };
    let state = "connecting";
    let closed = false;
    let failure = null;
    let everOpened = false;
    let generation = 0;
    let signaler = null;
    let unsubscribeSignals = null;
    let signalingEnabled = true;
    let signalFailures = 0;
    let rebuilding = null;
    let chain = Promise.resolve();
    let current = null;
    let remoteId = null;
    let sessionId = HOST ? randomHex(16) : null;
    let serialCounter = 0;
    let lastOffer = { peer: null, serial: 0 };
    let mismatchKey = "";
    let openedWaiter = deferred();
    let pulseTimer = 0;
    let watchTimer = 0;
    let deadlineTimer = 0;
    let claim = null;
    let collided = false;
    const EARLY_ICE = /* @__PURE__ */ new Map();
    function dispatch(event) {
      try {
        onStatus(event);
      } catch {
      }
      for (const LISTENER of [...LISTENERS]) {
        try {
          LISTENER(event);
        } catch {
        }
      }
    }
    function emit(type, detail = {}) {
      dispatch({ type, room, role, ...detail });
    }
    function reportError(code, error) {
      if (!closed) {
        emit("error", { code, error, message: String(error?.message ?? error) });
      }
    }
    const CHANNELS = createRoomChannels({
      onError: reportError,
      onSendFailure: () => queueMicrotask(() => reconnect({ reason: "send-failed" }))
    });
    function setState(next, detail = {}) {
      if (state === next) {
        return;
      }
      const PREVIOUS = state;
      state = next;
      CHANNELS.setState(next);
      emit("state", { state: next, previous: PREVIOUS, generation, ...detail });
    }
    async function openSignaling() {
      const SIGNALER = await signalerFactory({
        room,
        namespace: NAMESPACE,
        relays,
        signal: CONTROLLER.signal,
        timeoutMs: Math.min(timeoutMs, 1e4),
        onStatus: dispatch,
        identity: IDENTITY.capability()
      });
      const VALID = SIGNALER && ["send", "subscribe", "close"].every((key) => typeof SIGNALER[key] === "function") && SIGNALER.id === SELF;
      if (closed || !signalingEnabled || !VALID) {
        SIGNALER?.close?.();
        if (!closed && signalingEnabled) {
          throw new TypeError("room signaler capability: the signaler must use the identity it is given");
        }
        throw new Error("room aborted");
      }
      signaler = SIGNALER;
      signalFailures = 0;
      unsubscribeSignals = SIGNALER.subscribe(onSignal);
    }
    function closeSignaling() {
      unsubscribeSignals?.();
      unsubscribeSignals = null;
      signaler?.close();
      signaler = null;
    }
    function rebuildSignaling() {
      if (rebuilding) {
        return rebuilding;
      }
      closeSignaling();
      rebuilding = (async () => {
        while (signalingEnabled && !closed && !signaler) {
          try {
            await openSignaling();
          } catch (error) {
            if (signalingEnabled && !closed) {
              reportError("signaling-unavailable", error);
              await new Promise((resolve) => setTimeout(resolve, retryMs));
            }
          }
        }
        if (signaler && signalingEnabled && !closed) {
          emit("signaling-ready", { rebuilt: true });
          startPairing();
        }
      })().finally(() => {
        rebuilding = null;
      });
      return rebuilding;
    }
    function publish(to, payload, key = null) {
      const SIGNALER = signaler;
      if (!SIGNALER) {
        return Promise.resolve(false);
      }
      if (key && INFLIGHT.has(key)) {
        return INFLIGHT.get(key);
      }
      const PROMISE = Promise.resolve().then(() => SIGNALER.send(to, payload)).then(
        () => {
          if (signaler === SIGNALER) {
            signalFailures = 0;
          }
          return true;
        },
        (error) => {
          if (!closed && signaler === SIGNALER) {
            reportError("signal-error", error);
            if (++signalFailures >= 3) {
              rebuildSignaling();
            }
          }
          return false;
        }
      ).finally(() => {
        if (key && INFLIGHT.get(key) === PROMISE) {
          INFLIGHT.delete(key);
        }
      });
      if (key) {
        INFLIGHT.set(key, PROMISE);
      }
      return PROMISE;
    }
    function pulse() {
      if (closed || current || !signaler || rebuilding || claim) {
        return;
      }
      if (HOST) {
        publish("*", { type: "presence", ...HELLO }, "pulse");
      } else {
        publish(
          remoteId ?? "*",
          { type: "discover", ...HELLO, accepted: lastOffer.serial, acceptedFrom: lastOffer.peer },
          "pulse"
        );
      }
    }
    function startPairing() {
      stopPairing();
      if (closed || !signalingEnabled || state === "failed") {
        return;
      }
      pulseTimer = setInterval(pulse, retryMs);
      pulse();
    }
    function stopPairing() {
      clearInterval(pulseTimer);
      pulseTimer = 0;
    }
    function armDeadline(ms, fresh) {
      if (deadlineTimer && !fresh) {
        return;
      }
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => fail(everOpened ? "reconnect-timeout" : "timeout"), ms);
    }
    function clearDeadline() {
      clearTimeout(deadlineTimer);
      deadlineTimer = 0;
    }
    function startWatch() {
      stopWatch();
      watchTimer = setInterval(() => {
        const NEG = current;
        if (!NEG?.opened) {
          return;
        }
        if (CHANNEL_LABELS.some((label) => NEG.channels[label].readyState !== "open")) {
          lose(NEG, "datachannel-close");
        } else if (["failed", "closed"].includes(NEG.pc.connectionState)) {
          lose(NEG, "rtc-" + NEG.pc.connectionState);
        }
      }, WATCH_MS);
    }
    function stopWatch() {
      clearInterval(watchTimer);
      watchTimer = 0;
    }
    function dropNegotiation() {
      const NEG = current;
      if (!NEG) {
        return;
      }
      current = null;
      clearTimeout(NEG.timer);
      clearTimeout(NEG.graceTimer);
      clearTimeout(NEG.iceTimer);
      stopWatch();
      if (NEG.opened) {
        CHANNELS.detach();
      }
      for (const CHANNEL of Object.values(NEG.channels)) {
        CHANNEL.onopen = CHANNEL.onclose = CHANNEL.onerror = null;
      }
      NEG.pc.onicecandidate = NEG.pc.onconnectionstatechange = NEG.pc.oniceconnectionstatechange = null;
      NEG.pc.ondatachannel = null;
      try {
        NEG.pc.close();
      } catch {
      }
    }
    function lose(neg, reason, { resume = true } = {}) {
      if (closed || neg !== current) {
        return;
      }
      const WAS_OPEN = neg.opened;
      dropNegotiation();
      if (WAS_OPEN) {
        setState("interrupted", { reason });
        armDeadline(reconnectTimeoutMs, false);
      } else {
        emit("attempt-failed", { reason });
      }
      if (resume) {
        startPairing();
      }
    }
    function fail(reason) {
      if (closed || state === "failed") {
        return;
      }
      dropNegotiation();
      stopPairing();
      clearDeadline();
      signalingEnabled = false;
      closeSignaling();
      failure = Object.freeze({ reason, message: "room failed: " + reason });
      setState("failed", { reason });
      if (!everOpened) {
        openedWaiter.reject(Object.assign(new Error(failure.message), { code: reason }));
      }
    }
    function reconnect({ reason = "manual", newPeer = false } = {}) {
      if (typeof reason !== "string" || reason.length < 1 || reason.length > 64 || typeof newPeer !== "boolean") {
        throw new TypeError("reconnect options");
      }
      if (closed) {
        return false;
      }
      const REVIVE = state === "failed";
      dropNegotiation();
      if (newPeer) {
        remoteId = null;
      }
      if (REVIVE) {
        failure = null;
        signalingEnabled = true;
        if (!everOpened) {
          openedWaiter = deferred();
        }
      }
      setState(everOpened ? "interrupted" : "connecting", { reason, forced: true });
      armDeadline(everOpened ? reconnectTimeoutMs : timeoutMs, true);
      if (signaler) {
        startPairing();
      } else {
        rebuildSignaling();
      }
      return true;
    }
    function close(reason = "closed") {
      if (closed) {
        return;
      }
      closed = true;
      signalingEnabled = false;
      signal?.removeEventListener("abort", onAbort);
      clearDeadline();
      stopPairing();
      dropNegotiation();
      closeSignaling();
      CONTROLLER.abort();
      IDENTITY.release();
      claim?.resolve();
      if (!everOpened) {
        openedWaiter.reject(Object.assign(new Error("room closed: " + reason), { code: reason }));
      }
      setState("closed", { reason });
      CHANNELS.close();
      LISTENERS.clear();
    }
    function onAbort() {
      close("aborted");
    }
    function createNegotiation(number, initiator) {
      const PC = new globalThis.RTCPeerConnection(rtcConfig);
      const NEG = {
        serial: number,
        initiator,
        pc: PC,
        channels: {},
        pendingIce: [],
        outgoingIce: [],
        remoteSet: false,
        opened: false,
        timer: 0,
        graceTimer: 0,
        iceTimer: 0
      };
      current = NEG;
      PC.onicecandidate = (event) => queueCandidate(NEG, event.candidate);
      PC.onconnectionstatechange = PC.oniceconnectionstatechange = () => watchConnection(NEG);
      PC.ondatachannel = (event) => bindChannel(NEG, event.channel);
      if (initiator) {
        bindChannel(NEG, PC.createDataChannel("inputs", { ordered: false, maxRetransmits: 0 }));
        bindChannel(NEG, PC.createDataChannel("control", { ordered: true }));
        bindChannel(NEG, PC.createDataChannel("app", { ordered: true }));
      }
      NEG.timer = setTimeout(() => lose(NEG, "connect-timeout"), peerTimeoutMs);
      return NEG;
    }
    function bindChannel(neg, channel) {
      if (neg !== current || !CHANNEL_LABELS.includes(channel.label) || neg.channels[channel.label]) {
        channel.close();
        return;
      }
      neg.channels[channel.label] = channel;
      channel.onopen = () => maybeOpen(neg);
      channel.onclose = () => lose(neg, "datachannel-close");
      channel.onerror = (event) => {
        if (channel.readyState === "open") {
          reportError("channel-error", event?.error ?? event);
        }
      };
      maybeOpen(neg);
    }
    function maybeOpen(neg) {
      if (neg !== current || neg.opened || CHANNEL_LABELS.some((label) => neg.channels[label]?.readyState !== "open")) {
        return;
      }
      neg.opened = true;
      clearTimeout(neg.timer);
      CHANNELS.attach(neg.channels);
      everOpened = true;
      generation++;
      mismatchKey = "";
      clearDeadline();
      stopPairing();
      startWatch();
      openedWaiter.resolve();
      setState("open", { reconnect: generation > 1 });
    }
    function watchConnection(neg) {
      if (closed || neg !== current) {
        return;
      }
      const CONNECTION = neg.pc.connectionState;
      const ICE = neg.pc.iceConnectionState;
      if (CONNECTION === "failed" || CONNECTION === "closed" || ICE === "failed") {
        lose(neg, "rtc-" + (CONNECTION === "closed" ? "closed" : "failed"));
      } else if (CONNECTION === "disconnected" || ICE === "disconnected") {
        if (neg.opened) {
          setState("interrupted", { reason: "rtc-disconnected" });
        }
        if (!neg.graceTimer) {
          neg.graceTimer = setTimeout(() => {
            neg.graceTimer = 0;
            if (neg === current && ["disconnected", "failed", "closed"].includes(neg.pc.connectionState)) {
              lose(neg, "rtc-disconnected");
            }
          }, disconnectGraceMs);
        }
      } else {
        clearTimeout(neg.graceTimer);
        neg.graceTimer = 0;
        if (neg.opened && state === "interrupted") {
          setState("open", { reconnect: true, healed: true });
        }
      }
    }
    function queueCandidate(neg, candidate) {
      if (neg !== current) {
        return;
      }
      if (candidate) {
        if (neg.outgoingIce.length < ICE_BUFFER_LIMIT) {
          neg.outgoingIce.push(candidate.toJSON());
        }
        clearTimeout(neg.iceTimer);
        neg.iceTimer = setTimeout(() => flushCandidates(neg), ICE_BATCH_MS);
      } else {
        flushCandidates(neg);
      }
    }
    function flushCandidates(neg) {
      clearTimeout(neg.iceTimer);
      if (neg !== current || !remoteId) {
        return;
      }
      while (neg.outgoingIce.length) {
        publish(remoteId, {
          type: "ice",
          serial: neg.serial,
          candidates: neg.outgoingIce.splice(0, ICE_BATCH_LIMIT)
        });
      }
    }
    async function addCandidates(neg, candidates) {
      for (const CANDIDATE of candidates) {
        if (neg !== current) {
          return;
        }
        try {
          await neg.pc.addIceCandidate(CANDIDATE);
        } catch (error) {
          if (neg === current) {
            reportError("ice-candidate", error);
          }
        }
      }
    }
    async function settleRemote(neg, remote) {
      await neg.pc.setRemoteDescription({ type: remote.type, sdp: remote.sdp });
      if (neg !== current) {
        return false;
      }
      neg.remoteSet = true;
      await addCandidates(neg, neg.pendingIce.splice(0));
      return neg === current;
    }
    function failNegotiation(neg, error) {
      if (neg === current) {
        reportError("negotiation", error);
        lose(neg, "negotiation-error");
      }
    }
    function mismatchOf(message) {
      if (typeof message.version !== "string" || !Number.isSafeInteger(message.protocol)) {
        return void 0;
      }
      if (message.protocol !== PROTOCOL_VERSION) {
        return { kind: "protocol", local: PROTOCOL_VERSION, remote: message.protocol };
      }
      return message.version === version ? null : { kind: "version", local: version, remote: message.version };
    }
    function reportMismatch(peerId, mismatch) {
      const KEY = `${peerId}:${mismatch.kind}:${mismatch.remote}`;
      if (mismatchKey !== KEY) {
        mismatchKey = KEY;
        emit("version-mismatch", { peerId, ...mismatch });
      }
    }
    function onSignal(envelope) {
      const { from: FROM, to: TO, message: MESSAGE } = envelope ?? {};
      if (closed || !signalingEnabled || FROM === SELF || TO !== "*" && TO !== SELF) {
        return;
      }
      if (MESSAGE === null || typeof MESSAGE !== "object" || typeof FROM !== "string") {
        return;
      }
      chain = chain.then(() => handleSignal(FROM, MESSAGE)).catch((error) => reportError("signal", error));
    }
    function handleSignal(from, message) {
      if (closed || !signalingEnabled) {
        return void 0;
      }
      switch (message.type) {
        case "presence":
          return onPresence(from, message);
        case "discover":
          return onDiscover(from, message);
        case "offer":
          return onOffer(from, message);
        case "answer":
          return onAnswer(from, message);
        case "ice":
          return onIce(from, message);
        default:
          return void 0;
      }
    }
    function onPresence(from, message) {
      if (HOST) {
        collided = collided || !!claim;
        return;
      }
      if (current || remoteId && from !== remoteId) {
        return;
      }
      const MISMATCH = mismatchOf(message);
      if (MISMATCH) {
        reportMismatch(from, MISMATCH);
        fail("version-mismatch");
      }
    }
    async function onDiscover(from, message) {
      if (!HOST || claim) {
        return;
      }
      const MISMATCH = mismatchOf(message);
      if (MISMATCH === void 0) {
        return;
      }
      if (MISMATCH) {
        reportMismatch(from, MISMATCH);
        publish(from, { type: "presence", ...HELLO });
        return;
      }
      if (remoteId && from !== remoteId) {
        return;
      }
      if (current) {
        const DEAD = message.acceptedFrom === SELF && message.accepted >= current.serial;
        if (!DEAD) {
          return;
        }
        lose(current, "peer-restarted", { resume: false });
      }
      remoteId = from;
      const NEG = createNegotiation(++serialCounter, true);
      try {
        await NEG.pc.setLocalDescription(await NEG.pc.createOffer());
        if (NEG !== current) {
          return;
        }
        const SENT = await publish(from, {
          type: "offer",
          ...HELLO,
          serial: NEG.serial,
          sessionId,
          description: NEG.pc.localDescription.toJSON()
        });
        if (!SENT && NEG === current) {
          lose(NEG, "signal-error");
        }
      } catch (error) {
        failNegotiation(NEG, error);
      }
    }
    async function onOffer(from, message) {
      if (HOST || remoteId && from !== remoteId) {
        return;
      }
      const MISMATCH = mismatchOf(message);
      if (MISMATCH === void 0 || !IS_SERIAL(message.serial) || !SESSION_ID.test(message.sessionId ?? "")) {
        return;
      }
      if (MISMATCH) {
        reportMismatch(from, MISMATCH);
        fail("version-mismatch");
        return;
      }
      if (!description(message.description, "offer")) {
        return;
      }
      if (lastOffer.peer === from && message.serial <= lastOffer.serial) {
        return;
      }
      if (current) {
        lose(current, "peer-restarted", { resume: false });
      }
      remoteId = from;
      lastOffer = { peer: from, serial: message.serial };
      sessionId = message.sessionId;
      stopPairing();
      const NEG = createNegotiation(message.serial, false);
      NEG.pendingIce.push(...EARLY_ICE.get(`${from}:${message.serial}`) ?? []);
      EARLY_ICE.clear();
      try {
        if (!await settleRemote(NEG, message.description)) {
          return;
        }
        await NEG.pc.setLocalDescription(await NEG.pc.createAnswer());
        if (NEG !== current) {
          return;
        }
        const SENT = await publish(from, {
          type: "answer",
          serial: NEG.serial,
          description: NEG.pc.localDescription.toJSON()
        });
        if (!SENT && NEG === current) {
          lose(NEG, "signal-error");
        }
      } catch (error) {
        failNegotiation(NEG, error);
      }
    }
    async function onAnswer(from, message) {
      const NEG = current;
      if (!HOST || !NEG?.initiator || from !== remoteId || message.serial !== NEG.serial || NEG.remoteSet) {
        return;
      }
      if (!description(message.description, "answer")) {
        return;
      }
      try {
        await settleRemote(NEG, message.description);
      } catch (error) {
        failNegotiation(NEG, error);
      }
    }
    async function onIce(from, message) {
      const CANDIDATES = message.candidates;
      if (!IS_SERIAL(message.serial) || !Array.isArray(CANDIDATES) || CANDIDATES.length > ICE_BATCH_LIMIT) {
        return;
      }
      const NEG = current;
      if (NEG && from === remoteId && message.serial === NEG.serial) {
        if (NEG.remoteSet) {
          await addCandidates(NEG, CANDIDATES);
        } else if (NEG.pendingIce.length + CANDIDATES.length <= ICE_BUFFER_LIMIT) {
          NEG.pendingIce.push(...CANDIDATES);
        }
        return;
      }
      const NEWER = lastOffer.peer !== from || message.serial > lastOffer.serial;
      const KEY = `${from}:${message.serial}`;
      if (!HOST && NEWER && !(remoteId && from !== remoteId) && (EARLY_ICE.has(KEY) || EARLY_ICE.size < 8)) {
        const KEPT = EARLY_ICE.get(KEY) ?? [];
        if (KEPT.length + CANDIDATES.length <= ICE_BUFFER_LIMIT) {
          EARLY_ICE.set(KEY, [...KEPT, ...CANDIDATES]);
        }
      }
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await openSignaling();
      emit("room", { namespace });
      if (HOST && collisionCheckMs > 0) {
        await new Promise((resolve) => {
          claim = { resolve };
          claim.timer = setTimeout(resolve, collisionCheckMs);
        });
        clearTimeout(claim.timer);
        claim = null;
        if (closed) {
          throw new Error("room aborted");
        }
        if (collided) {
          throw Object.assign(new Error("room code is already in use; choose another four-digit code"), {
            code: "room-in-use"
          });
        }
      }
    } catch (error) {
      close("creation-failed");
      throw error;
    }
    armDeadline(timeoutMs, true);
    emit("signaling-ready");
    startPairing();
    return Object.freeze({
      get room() {
        return room;
      },
      role,
      get sessionId() {
        return sessionId;
      },
      localPlayerId: HOST ? "a" : "b",
      remotePlayerId: HOST ? "b" : "a",
      get peerId() {
        return remoteId;
      },
      get state() {
        return state;
      },
      get generation() {
        return generation;
      },
      get failure() {
        return failure;
      },
      get closed() {
        return closed;
      },
      get opened() {
        return openedWaiter.promise;
      },
      get peerConnection() {
        return current?.pc ?? null;
      },
      transport: CHANNELS.transport,
      app: CHANNELS.app,
      subscribe(listener) {
        if (typeof listener !== "function") {
          throw new TypeError("room subscriber");
        }
        if (closed) {
          return () => {
          };
        }
        LISTENERS.add(listener);
        return () => LISTENERS.delete(listener);
      },
      subscribeStatus: (listener) => CHANNELS.transport.subscribeStatus(listener),
      reconnect,
      close
    });
  }
  var STAR_HEADER = 24;
  var STAR_PAYLOAD = CHUNK_SIZE - STAR_HEADER;
  var DAY_MS = 24 * 60 * 60 * 1e3;
  var PROBE_MAGIC = new Uint8Array([66, 77, 68, 89, 78, 80, 82, 49]);
  var MAX_SIGNAL_BYTES = 128 * 1024;
  var MAX_BACKLOG_BYTES = 2 * 1024 * 1024;
  return __toCommonJS(entry_exports);
})();
