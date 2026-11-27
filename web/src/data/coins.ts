// Popular gold coins and local gold units per country. Weight and fineness are standard published specifications; the page shows the
// intrinsic gold-content value (weight x fineness x live spot), never a dealer price, so no premium or tax is included.
export interface Coin { name: string; grams: number; fine: number }
const OZ = 31.1035;
export const COINS: Record<string, Coin[]> = {
  EG: [{ name: "الجنيه الذهب (Gold pound, 21K)", grams: 8, fine: 0.875 }, { name: "نصف جنيه (Half pound)", grams: 4, fine: 0.875 }, { name: "ربع جنيه (Quarter pound)", grams: 2, fine: 0.875 }],
  TR: [{ name: "Çeyrek altın (quarter)", grams: 1.754, fine: 0.916 }, { name: "Yarım altın (half)", grams: 3.508, fine: 0.916 }, { name: "Tam altın (full)", grams: 7.016, fine: 0.916 }, { name: "Cumhuriyet altını (Republic)", grams: 7.216, fine: 0.916 }],
  LB: [{ name: "Lira (Ottoman/Lebanese gold pound)", grams: 7.216, fine: 0.917 }],
  SY: [{ name: "Lira (Ottoman gold pound)", grams: 7.216, fine: 0.917 }],
  IR: [{ name: "سکه بهار آزادی (Bahar Azadi)", grams: 8.133, fine: 0.9 }, { name: "نیم سکه (Half)", grams: 4.0665, fine: 0.9 }, { name: "ربع سکه (Quarter)", grams: 2.033, fine: 0.9 }],
  IN: [{ name: "Tola (24K)", grams: 11.6638, fine: 0.999 }, { name: "Tola (22K)", grams: 11.6638, fine: 0.916 }],
  PK: [{ name: "Tola (24K)", grams: 11.6638, fine: 0.999 }, { name: "Tola (22K)", grams: 11.6638, fine: 0.916 }],
  BD: [{ name: "Bhori / Tola (22K)", grams: 11.6638, fine: 0.916 }],
  NP: [{ name: "Tola (24K)", grams: 11.6638, fine: 0.999 }],
  TH: [{ name: "ทองคำแท่ง 1 บาท (Baht, 96.5%)", grams: 15.244, fine: 0.965 }, { name: "สลึง (Salung, quarter baht)", grams: 3.811, fine: 0.965 }],
  VN: [{ name: "Lượng / cây (37.5 g)", grams: 37.5, fine: 0.9999 }, { name: "Chỉ (3.75 g)", grams: 3.75, fine: 0.9999 }],
  HK: [{ name: "兩 Tael (37.429 g)", grams: 37.429, fine: 0.9999 }, { name: "Gold Panda 1 oz", grams: OZ, fine: 0.999 }],
  CN: [{ name: "Gold Panda 1 oz", grams: OZ, fine: 0.999 }, { name: "两 Liang (31.25 g)", grams: 31.25, fine: 0.9999 }],
  KR: [{ name: "돈 Don (3.75 g)", grams: 3.75, fine: 0.999 }, { name: "냥 Nyang (37.5 g)", grams: 37.5, fine: 0.999 }],
  MY: [{ name: "Kijang Emas 1 oz", grams: OZ, fine: 0.9999 }, { name: "Kijang Emas 1/2 oz", grams: OZ / 2, fine: 0.9999 }],
  SG: [{ name: "SG Lion 1 oz", grams: OZ, fine: 0.9999 }],
  US: [{ name: "American Gold Eagle 1 oz", grams: OZ, fine: 1 }, { name: "American Gold Buffalo 1 oz", grams: OZ, fine: 0.9999 }],
  CA: [{ name: "Gold Maple Leaf 1 oz", grams: OZ, fine: 0.9999 }],
  AU: [{ name: "Gold Kangaroo 1 oz", grams: OZ, fine: 0.9999 }],
  GB: [{ name: "Sovereign (full)", grams: 7.98805, fine: 0.9167 }, { name: "Britannia 1 oz", grams: OZ, fine: 0.9999 }],
  ZA: [{ name: "Krugerrand 1 oz", grams: OZ, fine: 1 }],
  MX: [{ name: "Centenario (50 pesos)", grams: 41.666, fine: 0.9 }],
  AT: [{ name: "Vienna Philharmonic 1 oz", grams: OZ, fine: 0.9999 }],
  CH: [{ name: "Vreneli (20 francs)", grams: 6.4516, fine: 0.9 }],
  FR: [{ name: "Napoléon (20 francs)", grams: 6.4516, fine: 0.9 }],
};
export const hasCoins = (cc: string) => !!COINS[cc];
