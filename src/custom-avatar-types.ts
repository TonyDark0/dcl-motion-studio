export type AvatarColor = [number, number, number];
export type AvatarAsset = {
  id: string;
  category: string;
  mainFile: string;
  files: Record<string, string>;
  hides: string[];
  replaces: string[];
};
export type CustomAvatar = {
  wallet: string;
  name: string;
  bodyShape: string;
  skin: AvatarColor;
  hair: AvatarColor;
  eyes: AvatarColor;
  assets: AvatarAsset[];
  hidden: string[];
  warnings: string[];
};
export const walletPattern = /^0x[a-fA-F0-9]{40}$/;
export const contentHashPattern = /^(?:baf[a-z2-7]{20,100}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;
