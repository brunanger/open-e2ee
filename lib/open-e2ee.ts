import { EncryptionService } from "./encryption";
import { PGPPrivateKey, PGPPublicKey, PGPService } from "./pgp";
import { hexStringToArray, arrayToHexString } from "./encoding.utils";

export interface E2EEItemEncrypted {
  encryptedKey: string;
  encryptedValue: string;
  keyObj: CryptoKey;
}

export interface E2EEItem {
  keyObj: CryptoKey;
  key: string;
  value: string;
}

export class OpenE2EE {
  private cryptoSvc: EncryptionService;
  private pgpService: PGPService;

  private passphrase: string;
  private privateKey?: PGPPrivateKey;
  private privateKeyEncryptedText?: string;
  private publicKeyText?: string;
  private publicKey?: PGPPublicKey;
  private userId: string;

  /**
   * @param userId user id in your platform
   * @param passphrase master password to encrypt PGP private key
   */
  constructor(userId: string, passphrase: string) {
    this.cryptoSvc = new EncryptionService();
    this.pgpService = new PGPService();
    this.userId = userId;
    this.passphrase = passphrase;
  }

  private encryptKey = async (key: Uint8Array): Promise<string> =>
    await this.pgpService.encryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      this.publicKey as PGPPublicKey,
      arrayToHexString(key)
    );

  private decryptKey = async (encryptedKey: string) => {
    const key = await this.pgpService.decryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      this.publicKey as PGPPublicKey,
      encryptedKey
    );
    return {
      key,
      keyObj: await this.cryptoSvc.importSymmetricKey(hexStringToArray(key)),
    };
  };

  /**
   * Loads data with a new PGP pair.
   * @example const e2eeSvc = await new E2EEService().build(passphrase);
   */
  build = async (): Promise<OpenE2EE> => {
    const { privateKey, publicKey } = await this.pgpService.generateKeyPair(
      this.passphrase,
      this.userId
    );
    const keysObj = await Promise.all([
      this.pgpService.decryptPrivateKey(privateKey, this.passphrase),
      this.pgpService.readPublicKey(publicKey),
    ]);
    this.privateKey = keysObj[0];
    this.publicKey = keysObj[1];
    this.privateKeyEncryptedText = privateKey;
    this.publicKeyText = publicKey;
    return this;
  };

  /**
   * Loads data with an existant PGP key pair.
   * @example const e2eeSvc = await new E2EEService().load(passphrase, privateKey, publicKey);
   * @param encryptedPrivateKey encrypted PGP private key
   * @param publicKey PGP public key
   * */
  load = async (
    encryptedPrivateKey: string,
    publicKey: string
  ): Promise<OpenE2EE> => {
    const [privateKeyObj, publicKeyObj] = await Promise.all([
      this.pgpService.decryptPrivateKey(encryptedPrivateKey, this.passphrase),
      this.pgpService.readPublicKey(publicKey),
    ]);
    this.privateKey = privateKeyObj;
    this.publicKey = publicKeyObj;
    this.privateKeyEncryptedText = encryptedPrivateKey;
    this.publicKeyText = publicKey;
    return this;
  };

  /**
   * Exports master key encrypted with a derived key from passphrase to save it in database.
   * @returns privateKey: encrypted PGP private key, publicKey: PGP public key
   */
  exportMasterKeys = async () => {
    return {
      privateKey: this.privateKeyEncryptedText || "",
      publicKey: this.publicKeyText || "",
    };
  };

  /**
   * Encrypts an item with a new key, and encrypts it with PGP.
   * @param data value to encrypt
   * @returns encrypted item with its encrypted key (as value and CryptoKey).
   */
  encrypt = async (data: string): Promise<E2EEItemEncrypted> => {
    const { key, keyObj } = await this.cryptoSvc.createEncryptionKey();
    const [encryptedKey, encryptedValue] = await Promise.all([
      this.encryptKey(key),
      this.pgpService.encrypt(arrayToHexString(key), data),
    ]);
    return { encryptedKey, encryptedValue, keyObj };
  };

  /**
   * Decrypts the key using PGP and the item with the decrypted key.
   * @param encryptedKey  encrypted key
   * @param encryptedData encrypted value
   * @returns both values and key decrypted
   */
  decrypt = async (
    encryptedKey: string,
    encryptedData: string
  ): Promise<E2EEItem> => {
    const { key, keyObj } = await this.decryptKey(encryptedKey);
    const value = await this.pgpService.decrypt(key, encryptedData);
    return { key, value, keyObj };
  };
}