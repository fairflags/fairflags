// The 32 nations of the pilot (placeholder list - the owner can change it) + the hub token. Symbols avoid anything that looks official (no FIFA / federation names).
export const HUB = { name: "Nations Cup", symbol: "NCUP" };
export const NATIONS = [
  ["Argentina", "ARG"], ["Brazil", "BRA"], ["France", "FRA"], ["England", "ENG"], ["Spain", "ESP"], ["Germany", "GER"], ["Portugal", "POR"], ["Netherlands", "NED"],
  ["Italy", "ITA"], ["Belgium", "BEL"], ["Croatia", "CRO"], ["Uruguay", "URU"], ["Morocco", "MAR"], ["USA", "USA"], ["Mexico", "MEX"], ["Japan", "JPN"],
  ["South Korea", "KOR"], ["Senegal", "SEN"], ["Nigeria", "NGA"], ["Egypt", "EGY"], ["Colombia", "COL"], ["Switzerland", "SUI"], ["Denmark", "DEN"], ["Poland", "POL"],
  ["Turkey", "TUR"], ["Saudi Arabia", "KSA"], ["Australia", "AUS"], ["Canada", "CAN"], ["Ghana", "GHA"], ["Ivory Coast", "CIV"], ["Ecuador", "ECU"], ["Serbia", "SRB"],
].map(([name, code]) => ({ name: `${name} Cup Coin`, symbol: `C${code}`, code, country: name }));
