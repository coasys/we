import { Ad4mClient, type SessionChallenge, type SignedKeyStatement } from '@coasys/ad4m';
import type { ConnectRequest } from '@coasys/connect';
import { signedStatement, statementBytes } from '@coasys/identity-wasm';

import { type BrowserKey, sign } from './browserKey';
import { ready } from './wasm';

/** The executor calls the frame makes, with no token: the person proves themself with the browser key. */
export interface Executor {
  sessionChallenge(): Promise<SessionChallenge>;
  loginWithKeyForWeb(proof: SignedKeyStatement, request: ConnectRequest): Promise<{ code: string }>;
  close(): void;
}

export type ExecutorFactory = (address: string) => Executor;

/** An executor reached through the ad4m client. */
export const ad4mExecutor: ExecutorFactory = (address) => {
  const client = new Ad4mClient(address);
  return {
    sessionChallenge: () => client.agent.sessionChallenge(),
    loginWithKeyForWeb: (proof, request) =>
      client.agent.loginWithKeyForWeb(
        proof,
        {
          appName: request.app.name,
          appDesc: request.app.description,
          appDomain: new URL(request.origin).host,
          appIconPath: request.app.iconPath,
          capabilities: request.capabilities,
        },
        request.app.appId,
      ),
    close: () => client.close(),
  };
};

/** The statement's audience: the origin the executor is dialed at, as http(s), never ws(s). */
const audienceOf = (address: string): string => new URL(address.replace(/^ws/, 'http')).origin;

/** The statement and this browser's signature over the bytes the WASM says to sign, as the executor takes it. */
async function signed(key: BrowserKey, statement: SignedKeyStatement['statement']): Promise<SignedKeyStatement> {
  await ready();
  return signedStatement(statement, await sign(key, statementBytes(statement))) as SignedKeyStatement;
}

const base = (key: BrowserKey, address: string, c: SessionChallenge, nowSeconds: number) => ({
  v: 1,
  scid: key.scid as string,
  key: key.signMultikey,
  executor: c.executor,
  audience: audienceOf(address),
  challenge: c.challenge,
  issuedAt: nowSeconds,
});

/** The `login` statement of a web client: it names the app's origin and the PKCE challenge. */
export const loginStatement = (
  key: BrowserKey,
  address: string,
  c: SessionChallenge,
  origin: string,
  codeChallenge: string,
  nowSeconds: number,
) =>
  signed(key, {
    ...base(key, address, c, nowSeconds),
    purpose: 'login',
    client: { kind: 'web', origin },
    codeChallenge,
  });

/** The `renew` statement for the grant the app's session holds. */
export const renewStatement = (
  key: BrowserKey,
  address: string,
  c: SessionChallenge,
  origin: string,
  grant: string,
  nowSeconds: number,
) => signed(key, { ...base(key, address, c, nowSeconds), purpose: 'renew', client: { kind: 'web', origin }, grant });
