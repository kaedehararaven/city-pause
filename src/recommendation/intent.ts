import type { Activity, ReturnMode, UserIntent } from "./model";

export type UserInput = {
  minutes: number;
  activity: Activity | "auto";
  text: string;
  avoidCost: boolean;
  nearby: boolean;
  returnMode?: ReturnMode;
};

const exclusions = [
  ["cafe", "咖啡(?:馆)?"], ["book", "书店"], ["lib", "图书馆"],
  ["park", "公园"], ["garden", "花园"],
] as const;

export function parseUserIntent(input: UserInput): UserIntent {
  const text = input.text.trim();
  const excludedKinds = exclusions
    .filter(([, word]) => new RegExp(`(?:不想|不要|不去|不喝|别推荐|排除|不喜欢)[^，。；,、]{0,5}${word}`).test(text))
    .map(([kind]) => kind);
  const wantsRest = /走累|累了|歇|休息|想坐|不想走路/.test(text);
  const wantsWalk = /散步|走走|逛逛|随便逛/.test(text) && !/(不想|不要|不去)(散步|走走|逛逛)/.test(text);
  const textAvoidsCost = /不想花钱|免费|不消费|不花钱/.test(text);
  const textWantsNearby = /不想走远|不走太远|少走/.test(text);
  return {
    availableMinutes: input.minutes,
    activity: input.activity === "auto" ? wantsRest ? "rest" : wantsWalk ? "walk" : "explore" : input.activity,
    returnMode: input.returnMode ?? "open_ended",
    avoidCost: input.avoidCost || textAvoidsCost,
    nearby: input.nearby || textWantsNearby,
    excludedKinds,
    rawText: text,
    source: {
      availableMinutes: "form",
      activity: input.activity === "auto" ? wantsRest || wantsWalk ? "text-rule" : "default" : "button",
      returnMode: input.returnMode === undefined ? "default" : "form",
      avoidCost: input.avoidCost ? "checkbox" : textAvoidsCost ? "text-rule" : "unspecified",
      nearby: input.nearby ? "checkbox" : textWantsNearby ? "text-rule" : "unspecified",
      excludedKinds: excludedKinds.length ? "text-rule" : "unspecified",
    },
  };
}
