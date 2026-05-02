/**
 * Rich demo data for an Australian local government council social media account.
 * Used when META_APP_ID is not set (IS_DEMO_MODE === true).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoPost {
  id: string;
  caption: string;
  media_url: string;
  thumbnail_url: string;
  permalink: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  engagement_score: number;
}

export interface DemoComment {
  id: string;
  post_id: string;
  text: string;
  username: string;
  timestamp: string;
  sentiment: "positive" | "negative" | "neutral" | "urgent";
  urgency: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return an ISO timestamp N days ago from today (2026-05-02). */
function daysAgo(days: number, hour = 9, minute = 0): string {
  const d = new Date("2026-05-02T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Offset a timestamp by N hours (for comment ordering). */
function hoursAfter(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

const BASE_URL = "https://www.instagram.com/p";
const THUMB_CDN = "https://placehold.co/600x600/1a73e8/ffffff?text=";
const IMG_CDN = "https://placehold.co/1080x1080/1a73e8/ffffff?text=";

function makeUrls(slug: string) {
  const encoded = encodeURIComponent(slug);
  return {
    media_url: `${IMG_CDN}${encoded}`,
    thumbnail_url: `${THUMB_CDN}${encoded}`,
    permalink: `${BASE_URL}/demo_${slug.replace(/\s+/g, "_").toLowerCase().slice(0, 12)}/`,
  };
}

function score(likes: number, comments: number): number {
  return likes + comments * 2;
}

// ---------------------------------------------------------------------------
// Demo account
// ---------------------------------------------------------------------------

export const DEMO_ACCOUNT: { id: string; name: string; username: string; platform: string } = {
  id: "demo_ig_17841400000000001",
  name: "City of Burnside",
  username: "cityofburnside",
  platform: "instagram",
};

// ---------------------------------------------------------------------------
// 25 demo posts — spanning last 90 days
// ---------------------------------------------------------------------------

const rawPosts: Omit<DemoPost, "engagement_score">[] = [
  {
    id: "post_001",
    caption:
      "🌳 Big news for Norwood! We're planting 120 new street trees along The Parade this winter. A greener, cooler streetscape for everyone. Works start Monday. #CityOfBurnside #UrbanForest #Norwood",
    ...makeUrls("Street Trees Norwood"),
    timestamp: daysAgo(2, 8, 30),
    like_count: 312,
    comments_count: 28,
    media_type: "IMAGE",
  },
  {
    id: "post_002",
    caption:
      "Your bins won't be collected this Friday 25 April due to the ANZAC Day public holiday. Your next collection will be the following Friday. Plan ahead! #BinDay #PublicHoliday",
    ...makeUrls("Bin Collection Holiday"),
    timestamp: daysAgo(5, 7, 0),
    like_count: 44,
    comments_count: 61,
    media_type: "IMAGE",
  },
  {
    id: "post_003",
    caption:
      "Kensington Oval upgrade is complete! New accessible change rooms, upgraded floodlights, and a refurbished scoreboard. Come down and check it out. #Kensington #LocalSports #CommunityInvestment",
    ...makeUrls("Kensington Oval Upgrade"),
    timestamp: daysAgo(8, 10, 0),
    like_count: 485,
    comments_count: 42,
    media_type: "IMAGE",
  },
  {
    id: "post_004",
    caption:
      "Road works on Marden Road begin next week. Expect single-lane closures between 7 am–5 pm weekdays for approximately 6 weeks. We apologise for the inconvenience. #RoadWorks #Marden",
    ...makeUrls("Marden Road Works"),
    timestamp: daysAgo(10, 9, 0),
    like_count: 31,
    comments_count: 88,
    media_type: "IMAGE",
  },
  {
    id: "post_005",
    caption:
      "🎉 Congratulations to this year's Burnside Community Award winners! Thank you to everyone who makes our community so special. See the full list at the link in bio. #BurnisdeAwards2026",
    ...makeUrls("Community Awards 2026"),
    timestamp: daysAgo(13, 11, 0),
    like_count: 278,
    comments_count: 19,
    media_type: "CAROUSEL_ALBUM",
  },
  {
    id: "post_006",
    caption:
      "Heathpool Reserve is getting a brand new playground! Construction starts in June. The new equipment is inclusive and designed for children of all abilities. #Heathpool #Playground #Inclusive",
    ...makeUrls("Heathpool Playground"),
    timestamp: daysAgo(16, 9, 30),
    like_count: 394,
    comments_count: 33,
    media_type: "IMAGE",
  },
  {
    id: "post_007",
    caption:
      "Our free green waste drop-off weekend is this Saturday and Sunday at the Burnside Depot. Bring your garden waste — no green waste bins required. 8 am–2 pm. #GreenWaste #Sustainability",
    ...makeUrls("Green Waste Drop-off"),
    timestamp: daysAgo(18, 8, 0),
    like_count: 167,
    comments_count: 14,
    media_type: "IMAGE",
  },
  {
    id: "post_008",
    caption:
      "IMPORTANT: The intersection of Kensington Road and Portrush Road will be closed from Saturday night for emergency pothole repairs. Detours via Magill Road. #RoadClosure #Emergency",
    ...makeUrls("Emergency Road Closure"),
    timestamp: daysAgo(20, 17, 0),
    like_count: 22,
    comments_count: 103,
    media_type: "IMAGE",
  },
  {
    id: "post_009",
    caption:
      "A reminder that Burnside Library's new extended hours start this Monday — open until 8 pm Tuesday and Thursday. Perfect for after-work borrowing! #BurnisdeLibrary #Community",
    ...makeUrls("Library Extended Hours"),
    timestamp: daysAgo(22, 10, 0),
    like_count: 198,
    comments_count: 11,
    media_type: "IMAGE",
  },
  {
    id: "post_010",
    caption:
      "Last weekend's Norwood Marden Autumn Festival was a huge success — over 4,000 attendees! Thank you to all volunteers and stallholders. See you next year! 🍂 #AutumnFestival #Norwood",
    ...makeUrls("Autumn Festival Recap"),
    timestamp: daysAgo(25, 12, 0),
    like_count: 521,
    comments_count: 47,
    media_type: "CAROUSEL_ALBUM",
  },
  {
    id: "post_011",
    caption:
      "Rates notices for 2025–26 will be mailed and emailed next week. Sign up for eBilling at the link in bio and go in the draw to win a $200 local business gift voucher. #Rates #eBilling",
    ...makeUrls("Rates Notice eBilling"),
    timestamp: daysAgo(27, 9, 0),
    like_count: 58,
    comments_count: 22,
    media_type: "IMAGE",
  },
  {
    id: "post_012",
    caption:
      "🚴 New protected bike lanes on Marden Terrace are now open! Part of our Active Travel Plan to make cycling safer for everyone. #CyclingInfrastructure #ActiveTravel #Marden",
    ...makeUrls("Protected Bike Lanes"),
    timestamp: daysAgo(30, 8, 0),
    like_count: 287,
    comments_count: 54,
    media_type: "VIDEO",
  },
  {
    id: "post_013",
    caption:
      "Bin collection in Heathpool and Kensington will be delayed by one day this week due to a contractor vehicle breakdown. Thursday collections will happen Friday. Apologies for the disruption.",
    ...makeUrls("Bin Delay Heathpool"),
    timestamp: daysAgo(33, 14, 30),
    like_count: 18,
    comments_count: 134,
    media_type: "IMAGE",
  },
  {
    id: "post_014",
    caption:
      "We're seeking community feedback on the draft Burnside Biodiversity Strategy 2026–2031. Have your say at the link in bio by 30 May. Your input shapes our environment. #Biodiversity #Community",
    ...makeUrls("Biodiversity Strategy"),
    timestamp: daysAgo(36, 11, 0),
    like_count: 143,
    comments_count: 9,
    media_type: "IMAGE",
  },
  {
    id: "post_015",
    caption:
      "🏊 Norwood Pool is open for the last week of the season. Make the most of it before we close for winter maintenance on Sunday 6 April. See website for session times. #NorwoodPool",
    ...makeUrls("Norwood Pool Last Week"),
    timestamp: daysAgo(40, 8, 0),
    like_count: 224,
    comments_count: 18,
    media_type: "IMAGE",
  },
  {
    id: "post_016",
    caption:
      "Stormwater drain upgrades on Burnside Road are causing minor surface disruption near the Heathpool intersection. Works will be complete by end of May. Thank you for your patience.",
    ...makeUrls("Stormwater Drain Works"),
    timestamp: daysAgo(43, 9, 0),
    like_count: 27,
    comments_count: 49,
    media_type: "IMAGE",
  },
  {
    id: "post_017",
    caption:
      "Calling all young artists! The Burnside Youth Art Prize is now open for entries — ages 12–25, any medium. $1,500 in prizes. Entries close 15 May. Details at link in bio. #YouthArt #Burnside",
    ...makeUrls("Youth Art Prize"),
    timestamp: daysAgo(46, 10, 0),
    like_count: 189,
    comments_count: 8,
    media_type: "IMAGE",
  },
  {
    id: "post_018",
    caption:
      "Our Solar for Councils program has now offset over 500 tonnes of CO₂ since 2023. Here's how we're tracking toward our net-zero goal. 🌱 #NetZero #SolarEnergy #Sustainability",
    ...makeUrls("Solar CO2 Milestone"),
    timestamp: daysAgo(50, 11, 0),
    like_count: 246,
    comments_count: 15,
    media_type: "CAROUSEL_ALBUM",
  },
  {
    id: "post_019",
    caption:
      "Urgent notice: Flooding on Portrush Road near the Kensington junction. Road is closed. Emergency crews on site. Avoid the area and use alternative routes. Updates to follow.",
    ...makeUrls("Flooding Portrush Road"),
    timestamp: daysAgo(54, 6, 15),
    like_count: 39,
    comments_count: 176,
    media_type: "IMAGE",
  },
  {
    id: "post_020",
    caption:
      "The Marden Community Centre has been fully renovated! New kitchen, hearing loop, accessible toilets, and fresh fit-out throughout. Bookings now open. #MardenCommunity #Accessible",
    ...makeUrls("Marden Community Centre"),
    timestamp: daysAgo(58, 10, 30),
    like_count: 333,
    comments_count: 24,
    media_type: "CAROUSEL_ALBUM",
  },
  {
    id: "post_021",
    caption:
      "Tonight's council meeting will consider the draft 2026–27 Annual Business Plan and Budget. Tune in live on our YouTube channel from 7 pm. Public question time at 7:30 pm. #CouncilMeeting",
    ...makeUrls("Council Budget Meeting"),
    timestamp: daysAgo(62, 15, 0),
    like_count: 72,
    comments_count: 31,
    media_type: "IMAGE",
  },
  {
    id: "post_022",
    caption:
      "🌸 Spring planting is underway at Heathpool Park — 2,000 native bulbs and groundcovers going in this week. The park will look spectacular by October! #Heathpool #NativePlants",
    ...makeUrls("Heathpool Park Planting"),
    timestamp: daysAgo(67, 9, 0),
    like_count: 408,
    comments_count: 20,
    media_type: "IMAGE",
  },
  {
    id: "post_023",
    caption:
      "Reminder: Development applications and planning documents are available for public inspection at the Burnside Civic Centre, 401 Greenhill Road, during business hours. #PlanningDA",
    ...makeUrls("Planning DA Notice"),
    timestamp: daysAgo(72, 11, 0),
    like_count: 14,
    comments_count: 6,
    media_type: "IMAGE",
  },
  {
    id: "post_024",
    caption:
      "What a weekend! The Burnside Junior Football Carnival brought together 14 clubs and over 600 kids. Go Norwood Magpies! 🏉 #JuniorFootball #LocalSports #CommunitySpirit",
    ...makeUrls("Junior Football Carnival"),
    timestamp: daysAgo(78, 16, 0),
    like_count: 461,
    comments_count: 38,
    media_type: "CAROUSEL_ALBUM",
  },
  {
    id: "post_025",
    caption:
      "As we head into cooler months, remember: only run dishwashers and washing machines in off-peak hours to reduce grid pressure. Small actions, big difference. #EnergySaving #Sustainability",
    ...makeUrls("Energy Saving Tips"),
    timestamp: daysAgo(85, 8, 0),
    like_count: 96,
    comments_count: 7,
    media_type: "IMAGE",
  },
];

export const DEMO_POSTS: DemoPost[] = rawPosts.map((p) => ({
  ...p,
  engagement_score: score(p.like_count, p.comments_count),
}));

// ---------------------------------------------------------------------------
// Demo comments — 4-6 per high-engagement post (like_count > 100)
// ---------------------------------------------------------------------------

export const DEMO_COMMENTS: DemoComment[] = [
  // post_001 — Street Trees Norwood (312 likes)
  {
    id: "cmt_001_01",
    post_id: "post_001",
    text: "This is absolutely wonderful! The Parade is going to look stunning. Thank you for investing in our suburb.",
    username: "sarah_norwood_mum",
    timestamp: hoursAfter(daysAgo(2, 8, 30), 1),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_001_02",
    post_id: "post_001",
    text: "Great initiative! Which species are being planted? Hoping for some native gums.",
    username: "jb_gardener",
    timestamp: hoursAfter(daysAgo(2, 8, 30), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_001_03",
    post_id: "post_001",
    text: "Will there be parking disruptions on The Parade during planting? I rely on street parking for my business.",
    username: "theparade_cafe",
    timestamp: hoursAfter(daysAgo(2, 8, 30), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_001_04",
    post_id: "post_001",
    text: "Love this! More trees = cooler streets in summer. Keep it coming, Council.",
    username: "burnside_resident_k",
    timestamp: hoursAfter(daysAgo(2, 8, 30), 5),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_001_05",
    post_id: "post_001",
    text: "Finally! Been asking about this for two years. Well done.",
    username: "norwood_local1",
    timestamp: hoursAfter(daysAgo(2, 8, 30), 7),
    sentiment: "positive",
    urgency: false,
  },

  // post_002 — Bin Collection Holiday (44 likes, 61 comments)
  {
    id: "cmt_002_01",
    post_id: "post_002",
    text: "My bin wasn't collected LAST Friday either — nothing to do with the public holiday. Who do I call?",
    username: "marden_frustrated",
    timestamp: hoursAfter(daysAgo(5, 7, 0), 2),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_002_02",
    post_id: "post_002",
    text: "Thanks for the heads up! Does this apply to recycling bins too or just general waste?",
    username: "kensington_kate",
    timestamp: hoursAfter(daysAgo(5, 7, 0), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_002_03",
    post_id: "post_002",
    text: "Good to know. Could you email residents as well? Not everyone checks Instagram.",
    username: "heathpool_helen",
    timestamp: hoursAfter(daysAgo(5, 7, 0), 4),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_002_04",
    post_id: "post_002",
    text: "This is getting ridiculous. Third disruption this month. Our bins are overflowing. Unacceptable service.",
    username: "angry_ratepayer_burn",
    timestamp: hoursAfter(daysAgo(5, 7, 0), 6),
    sentiment: "negative",
    urgency: false,
  },

  // post_003 — Kensington Oval (485 likes)
  {
    id: "cmt_003_01",
    post_id: "post_003",
    text: "My kids play cricket here every Saturday — this upgrade is incredible. Thank you so much!",
    username: "cricket_dad_kensington",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 1),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_003_02",
    post_id: "post_003",
    text: "The new change rooms are a game changer. Really appreciate the accessible design.",
    username: "norwood_netball_club",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_003_03",
    post_id: "post_003",
    text: "Is there additional car parking planned? Saturdays are chaotic around the oval.",
    username: "kensington_paul",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_003_04",
    post_id: "post_003",
    text: "Great to see rates money going to something tangible. Keep up the good work!",
    username: "burnside_rates_happy",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 5),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_003_05",
    post_id: "post_003",
    text: "Absolutely love this. The old change rooms were an embarrassment. This is exactly what local sport needs.",
    username: "sa_football_fan",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 8),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_003_06",
    post_id: "post_003",
    text: "Will the floodlights allow night games now? Would love to see evening cricket in summer.",
    username: "cricket_coach_ade",
    timestamp: hoursAfter(daysAgo(8, 10, 0), 10),
    sentiment: "positive",
    urgency: false,
  },

  // post_004 — Marden Road Works (31 likes, 88 comments)
  {
    id: "cmt_004_01",
    post_id: "post_004",
    text: "Six weeks?! This is going to be a nightmare for my morning commute. Is there any way to speed it up?",
    username: "commuter_marden",
    timestamp: hoursAfter(daysAgo(10, 9, 0), 1),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_004_02",
    post_id: "post_004",
    text: "What's the detour route for trucks? My delivery business uses Marden Road every day.",
    username: "marden_delivery_co",
    timestamp: hoursAfter(daysAgo(10, 9, 0), 2),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_004_03",
    post_id: "post_004",
    text: "This road has been a mess for years — glad it's finally being fixed even if the disruption is annoying.",
    username: "realist_resident",
    timestamp: hoursAfter(daysAgo(10, 9, 0), 4),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_004_04",
    post_id: "post_004",
    text: "This is taking too long. I submitted a pothole report six months ago and nothing happened until now.",
    username: "marden_disgruntled",
    timestamp: hoursAfter(daysAgo(10, 9, 0), 6),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_004_05",
    post_id: "post_004",
    text: "Can you please confirm whether the Marden Primary School bus stop will be affected? Asking for all the parents!",
    username: "marden_school_mum",
    timestamp: hoursAfter(daysAgo(10, 9, 0), 7),
    sentiment: "neutral",
    urgency: false,
  },

  // post_006 — Heathpool Playground (394 likes)
  {
    id: "cmt_006_01",
    post_id: "post_006",
    text: "My daughter has been asking for a new playground for so long. This is the best news! When's the opening?",
    username: "heathpool_mum_two",
    timestamp: hoursAfter(daysAgo(16, 9, 30), 1),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_006_02",
    post_id: "post_006",
    text: "Incredible to see inclusive design being prioritised. Our son uses a wheelchair and the current equipment is completely inaccessible.",
    username: "accessibility_advocate_sa",
    timestamp: hoursAfter(daysAgo(16, 9, 30), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_006_03",
    post_id: "post_006",
    text: "Will there be shade sails installed? The current park gets scorching in summer — not safe for small kids.",
    username: "parent_of_three_burnside",
    timestamp: hoursAfter(daysAgo(16, 9, 30), 4),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_006_04",
    post_id: "post_006",
    text: "Love this! Heathpool Reserve needed some love. Thank you for listening to the community.",
    username: "heathpool_proud",
    timestamp: hoursAfter(daysAgo(16, 9, 30), 6),
    sentiment: "positive",
    urgency: false,
  },

  // post_008 — Emergency Road Closure (22 likes, 103 comments)
  {
    id: "cmt_008_01",
    post_id: "post_008",
    text: "This is dangerous! I nearly drove into the pothole yesterday before I saw it. Why wasn't this fixed sooner?",
    username: "kensington_driver_angus",
    timestamp: hoursAfter(daysAgo(20, 17, 0), 1),
    sentiment: "urgent",
    urgency: true,
  },
  {
    id: "cmt_008_02",
    post_id: "post_008",
    text: "The detour via Magill Road is going to be chaos during school drop-off. Can you please advise parents?",
    username: "kensington_school_parent",
    timestamp: hoursAfter(daysAgo(20, 17, 0), 2),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_008_03",
    post_id: "post_008",
    text: "How long will this closure last? I have a hospital appointment Saturday morning.",
    username: "worried_resident_01",
    timestamp: hoursAfter(daysAgo(20, 17, 0), 3),
    sentiment: "neutral",
    urgency: true,
  },
  {
    id: "cmt_008_04",
    post_id: "post_008",
    text: "Good to see emergency crews responding quickly at least. Thanks for the update.",
    username: "fair_minded_burnside",
    timestamp: hoursAfter(daysAgo(20, 17, 0), 4),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_008_05",
    post_id: "post_008",
    text: "I reported that pothole three weeks ago. Unacceptable that it took an emergency to get it fixed.",
    username: "frustrated_kensington_r",
    timestamp: hoursAfter(daysAgo(20, 17, 0), 5),
    sentiment: "negative",
    urgency: false,
  },

  // post_010 — Autumn Festival (521 likes)
  {
    id: "cmt_010_01",
    post_id: "post_010",
    text: "We had such an amazing time! The food stalls were incredible. Can't wait for next year already!",
    username: "festival_lover_norwood",
    timestamp: hoursAfter(daysAgo(25, 12, 0), 1),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_010_02",
    post_id: "post_010",
    text: "The kids' zone was the highlight for us. Great job to all the volunteers who ran it!",
    username: "family_fun_burnside",
    timestamp: hoursAfter(daysAgo(25, 12, 0), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_010_03",
    post_id: "post_010",
    text: "Loved it but parking was a real struggle. Can you work with local businesses to open more parking next year?",
    username: "norwood_regular",
    timestamp: hoursAfter(daysAgo(25, 12, 0), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_010_04",
    post_id: "post_010",
    text: "Best community event of the year, hands down. Burnside really knows how to bring people together.",
    username: "community_booster_sa",
    timestamp: hoursAfter(daysAgo(25, 12, 0), 5),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_010_05",
    post_id: "post_010",
    text: "Is there a survey to give feedback? I had some suggestions for the entertainment lineup.",
    username: "constructive_marden",
    timestamp: hoursAfter(daysAgo(25, 12, 0), 8),
    sentiment: "neutral",
    urgency: false,
  },

  // post_012 — Bike Lanes (287 likes, 54 comments)
  {
    id: "cmt_012_01",
    post_id: "post_012",
    text: "Finally! I've been waiting for protected lanes here for years. Cycled it this morning — smooth and safe. Love it.",
    username: "cycling_commuter_marden",
    timestamp: hoursAfter(daysAgo(30, 8, 0), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_012_02",
    post_id: "post_012",
    text: "Great initiative but where does it connect to? Is there a network map available?",
    username: "bikemap_enthusiast",
    timestamp: hoursAfter(daysAgo(30, 8, 0), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_012_03",
    post_id: "post_012",
    text: "As a local business owner I'm worried about delivery access. Have you considered the impact on loading zones?",
    username: "marden_terrace_shop",
    timestamp: hoursAfter(daysAgo(30, 8, 0), 5),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_012_04",
    post_id: "post_012",
    text: "This is exactly the sort of infrastructure that will get people out of cars. Keep it up!",
    username: "active_travel_advocate",
    timestamp: hoursAfter(daysAgo(30, 8, 0), 7),
    sentiment: "positive",
    urgency: false,
  },

  // post_013 — Bin Delay Heathpool (18 likes, 134 comments)
  {
    id: "cmt_013_01",
    post_id: "post_013",
    text: "This is NOT acceptable. My bin has missed collection two weeks running. My street smells terrible.",
    username: "heathpool_furious",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 1),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_013_02",
    post_id: "post_013",
    text: "How do I report a missed bin? Is there a phone number or online form?",
    username: "new_to_heathpool",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 2),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_013_03",
    post_id: "post_013",
    text: "The bins in Kensington were also missed last week. Is the contractor having ongoing issues? This is ridiculous.",
    username: "kensington_not_happy",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 3),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_013_04",
    post_id: "post_013",
    text: "A contractor vehicle breakdown is not a good enough excuse. What's the contingency plan? Other councils have backup arrangements.",
    username: "ratepayer_standards",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 5),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_013_05",
    post_id: "post_013",
    text: "The smell outside my house is unbearable. We have young children. This is a health issue now.",
    username: "heathpool_parent_urgent",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 6),
    sentiment: "urgent",
    urgency: true,
  },
  {
    id: "cmt_013_06",
    post_id: "post_013",
    text: "At least you told us. Better than finding out when we put our bins out. Appreciate the communication.",
    username: "gracious_resident_h",
    timestamp: hoursAfter(daysAgo(33, 14, 30), 8),
    sentiment: "positive",
    urgency: false,
  },

  // post_019 — Flooding Portrush Road (39 likes, 176 comments)
  {
    id: "cmt_019_01",
    post_id: "post_019",
    text: "The road is flooded right up to the footpath — this is really dangerous. Please get crews here ASAP.",
    username: "portrush_rd_witness",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 1),
    sentiment: "urgent",
    urgency: true,
  },
  {
    id: "cmt_019_02",
    post_id: "post_019",
    text: "My car got water damage trying to get through before I saw the closure. Who do I contact about this?",
    username: "kensington_car_damage",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 2),
    sentiment: "urgent",
    urgency: true,
  },
  {
    id: "cmt_019_03",
    post_id: "post_019",
    text: "Is Kensington Road also affected? I need to get to work in the CBD.",
    username: "morning_commuter_sa",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 2),
    sentiment: "neutral",
    urgency: true,
  },
  {
    id: "cmt_019_04",
    post_id: "post_019",
    text: "This flooding keeps happening at this spot every time it rains heavily. When will the stormwater infrastructure be upgraded? This is a systemic issue.",
    username: "infrastructure_watchdog",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 4),
    sentiment: "negative",
    urgency: false,
  },
  {
    id: "cmt_019_05",
    post_id: "post_019",
    text: "Thank you for the fast update on social media. Really helps people avoid the area.",
    username: "grateful_local_kens",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 5),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_019_06",
    post_id: "post_019",
    text: "Still flooded three hours later. Is anyone actually working on this? This is dangerous for pedestrians too.",
    username: "concerned_bystander_01",
    timestamp: hoursAfter(daysAgo(54, 6, 15), 3),
    sentiment: "urgent",
    urgency: true,
  },

  // post_020 — Marden Community Centre (333 likes)
  {
    id: "cmt_020_01",
    post_id: "post_020",
    text: "The new kitchen is fantastic! We ran our first cooking class here last night and it was perfect.",
    username: "marden_community_group",
    timestamp: hoursAfter(daysAgo(58, 10, 30), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_020_02",
    post_id: "post_020",
    text: "How do I book the centre for a private function? Is there a hire fee?",
    username: "event_planner_marden",
    timestamp: hoursAfter(daysAgo(58, 10, 30), 3),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_020_03",
    post_id: "post_020",
    text: "The hearing loop is such an important addition. Thank you for thinking about all members of our community.",
    username: "deaf_community_sa",
    timestamp: hoursAfter(daysAgo(58, 10, 30), 4),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_020_04",
    post_id: "post_020",
    text: "It looks gorgeous in the photos! Well done to everyone involved in the project.",
    username: "proud_marden_resident",
    timestamp: hoursAfter(daysAgo(58, 10, 30), 6),
    sentiment: "positive",
    urgency: false,
  },

  // post_022 — Heathpool Park Planting (408 likes)
  {
    id: "cmt_022_01",
    post_id: "post_022",
    text: "This park is right near my house and I'm so excited to see it bloom! Amazing work.",
    username: "heathpool_neighbour",
    timestamp: hoursAfter(daysAgo(67, 9, 0), 1),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_022_02",
    post_id: "post_022",
    text: "Which native species are going in? Hoping to see some of the local Kangaroo Paw varieties.",
    username: "native_plant_nerd",
    timestamp: hoursAfter(daysAgo(67, 9, 0), 3),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_022_03",
    post_id: "post_022",
    text: "Can community members volunteer to help with planting? Would love to be involved.",
    username: "green_volunteer_sa",
    timestamp: hoursAfter(daysAgo(67, 9, 0), 4),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_022_04",
    post_id: "post_022",
    text: "Beautiful initiative. This is why I love living in Burnside. Great council doing great work.",
    username: "burnside_believer",
    timestamp: hoursAfter(daysAgo(67, 9, 0), 6),
    sentiment: "positive",
    urgency: false,
  },

  // post_024 — Junior Football Carnival (461 likes)
  {
    id: "cmt_024_01",
    post_id: "post_024",
    text: "My son played his first ever tackle football game here on Saturday. He's absolutely hooked. Best day ever!",
    username: "footy_dad_norwood",
    timestamp: hoursAfter(daysAgo(78, 16, 0), 2),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_024_02",
    post_id: "post_024",
    text: "Go Magpies! 🏉 Brilliant event, so well organised. Thank you to all the volunteers.",
    username: "norwood_magpie_mum",
    timestamp: hoursAfter(daysAgo(78, 16, 0), 3),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_024_03",
    post_id: "post_024",
    text: "Incredible to see 14 clubs come together. This is what community sport is all about.",
    username: "local_sport_supporter",
    timestamp: hoursAfter(daysAgo(78, 16, 0), 4),
    sentiment: "positive",
    urgency: false,
  },
  {
    id: "cmt_024_04",
    post_id: "post_024",
    text: "Could you share photos from the day? Would love to find a photo of my kid's team.",
    username: "carnival_parent_03",
    timestamp: hoursAfter(daysAgo(78, 16, 0), 5),
    sentiment: "neutral",
    urgency: false,
  },
  {
    id: "cmt_024_05",
    post_id: "post_024",
    text: "Will there be a winter carnival too? The kids loved it so much.",
    username: "burnside_sports_mum",
    timestamp: hoursAfter(daysAgo(78, 16, 0), 7),
    sentiment: "positive",
    urgency: false,
  },
];

// ---------------------------------------------------------------------------
// Demo mode flag
// ---------------------------------------------------------------------------

/**
 * True when META_APP_ID is not set — the app runs on demo data instead of
 * calling the live Instagram Graph API.
 */
export const IS_DEMO_MODE: boolean = !process.env.META_APP_ID;
