// Bergen County, NJ - the ZIP codes we serve, each with its town. The
// registration form uses it two ways: to keep the community Bergen-only
// (an outside ZIP is told so, kindly) and to name the town without asking.
export const BERGEN_ZIPS: Record<string, string> = {
  "07010": "Cliffside Park", "07020": "Edgewater", "07022": "Fairview", "07024": "Fort Lee",
  "07026": "Garfield", "07031": "North Arlington", "07057": "Wallington", "07070": "Rutherford",
  "07071": "Lyndhurst", "07072": "Carlstadt", "07073": "East Rutherford", "07074": "Moonachie",
  "07075": "Wood-Ridge", "07401": "Allendale", "07407": "Elmwood Park", "07410": "Fair Lawn",
  "07417": "Franklin Lakes", "07423": "Ho-Ho-Kus", "07430": "Mahwah", "07432": "Midland Park",
  "07436": "Oakland", "07446": "Ramsey", "07450": "Ridgewood", "07451": "Ridgewood",
  "07452": "Glen Rock", "07458": "Saddle River", "07463": "Waldwick", "07481": "Wyckoff",
  "07495": "Mahwah", "07601": "Hackensack", "07602": "Hackensack", "07603": "Bogota",
  "07604": "Hasbrouck Heights", "07605": "Leonia", "07606": "South Hackensack", "07607": "Maywood",
  "07608": "Teterboro", "07620": "Alpine", "07621": "Bergenfield", "07624": "Closter",
  "07626": "Cresskill", "07627": "Demarest", "07628": "Dumont", "07630": "Emerson",
  "07631": "Englewood", "07632": "Englewood Cliffs", "07640": "Harrington Park", "07641": "Haworth",
  "07642": "Hillsdale", "07643": "Little Ferry", "07644": "Lodi", "07645": "Montvale",
  "07646": "New Milford", "07647": "Northvale", "07648": "Norwood", "07649": "Oradell",
  "07650": "Palisades Park", "07652": "Paramus", "07653": "Paramus", "07656": "Park Ridge",
  "07657": "Ridgefield", "07660": "Ridgefield Park", "07661": "River Edge", "07662": "Rochelle Park",
  "07663": "Saddle Brook", "07666": "Teaneck", "07670": "Tenafly", "07675": "Westwood",
  "07676": "Township of Washington", "07677": "Woodcliff Lake",
};

export const isBergenZip = (zip: string) => /^\d{5}$/.test(zip) && zip in BERGEN_ZIPS;
export const townForZip = (zip: string) => BERGEN_ZIPS[zip] ?? null;
