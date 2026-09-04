// Mina, munni's assistant persona (user-provided art, optimized from
// mina/ via scripts — swap localized scenario files in by NAME later).
import exprSmile from '@/assets/mina/expr-smile.webp';
import exprThinking from '@/assets/mina/expr-thinking.webp';
import exprArmCrossed from '@/assets/mina/expr-armcrossed.webp';
import exprLaugh from '@/assets/mina/expr-laugh.webp';
import exprSad from '@/assets/mina/expr-sad.webp';
import exprSurprised from '@/assets/mina/expr-surprised.webp';
import fullGreeting from '@/assets/mina/full-greeting.webp';
import fullGreetingHd from '@/assets/mina/full-greeting-hd.webp';
import sceneSpaces from '@/assets/mina/scene-spaces.webp';
import sceneFamily from '@/assets/mina/scene-family.webp';
import sceneAcctManual from '@/assets/mina/scene-acct-manual.webp';
import sceneAcctImport from '@/assets/mina/scene-acct-import.webp';
import sceneAcctLinked from '@/assets/mina/scene-acct-linked.webp';
import sceneTxAccount from '@/assets/mina/scene-tx-account.webp';

export const MINA_EXPR = {
  smile: exprSmile,
  thinking: exprThinking,
  armcrossed: exprArmCrossed,
  laugh: exprLaugh,
  sad: exprSad,
  surprised: exprSurprised,
} as const;
export type MinaExpr = keyof typeof MINA_EXPR;

export const MINA_ART = {
  greeting: fullGreeting,
  // the wrap screen's figure — the HD greeting (user request 2026-08-01,
  // converted from mina/full-body/mina-greeting-hd.png)
  handopen: fullGreetingHd,
  spaces: sceneSpaces,
  family: sceneFamily,
  // art↔content mapping corrected against the actual files (user ss):
  // finacc-01 = the three kinds at a glance, finacc-02 = manual lives in
  // one space, finacc-03 = imported/linked are global and attach
  acctKinds: sceneAcctManual,
  acctManual: sceneAcctImport,
  acctGlobal: sceneAcctLinked,
  txAccount: sceneTxAccount,
} as const;
export type MinaArt = keyof typeof MINA_ART;
