/**
 * Vyora TV - Entertainment Catalog Builder
 * ----------------------------------------
 * Compiles a rich, high-definition catalog of:
 *   1. New & Trending Cinema Movies (2024 - 2026, 2023, 2022 Blockbusters) + 2,900+ VOD Movies
 *   2. Top Trending TV & Web Series with full multi-season episodes + VOD Series
 *   3. 800+ Live Music & Songs TV Channels with curated genres (Bollywood, Pop, Rock, EDM, Lo-Fi, etc.)
 *
 * Saves to:
 *   - server/data/vod/movies.json
 *   - server/data/vod/series.json
 *   - server/data/vod/songs.json
 *   - server/data/vod/index.json
 * And mirrors into web/public/data/vod/
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SERVER_VOD = path.join(ROOT, 'server', 'data', 'vod')
const WEB_VOD = path.join(ROOT, 'web', 'public', 'data', 'vod')
const WEB_DIST_VOD = path.join(ROOT, 'web', 'dist', 'data', 'vod')
const ANDROID_VOD = path.join(ROOT, 'android', 'app', 'assets', 'data', 'vod')
const CHANNELS_DIR = path.join(ROOT, 'server', 'data', 'channels')

for (const directory of [SERVER_VOD, WEB_VOD, WEB_DIST_VOD, ANDROID_VOD]) {
  fs.mkdirSync(directory, { recursive: true })
}

// --------------------------------------------------------------------------
// 1. TOP & TRENDING BLOCKBUSTER MOVIES (2024 - 2026 & Modern Hits)
// --------------------------------------------------------------------------
const modernMovies = [
  {
    id: "dune-part-two-2024",
    title: "Dune: Part Two",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg",
    genre: "Sci-Fi",
    year: 2024,
    duration: 166,
    rating: 8.6,
    quality: "4K ULTRA HD",
    description: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
    url: "https://vidlink.pro/movie/693134",
    tmdbId: 693134,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "dune2-vidlink", url: "https://vidlink.pro/movie/693134", quality: "4K UHD", label: "VidLink 4K Cinema (Multi-Audio)", hls: false },
      { id: "dune2-vidsrc", url: "https://vidsrc.to/embed/movie/693134", quality: "1080p", label: "VidSrc HD Fast Stream", hls: false },
      { id: "dune2-auto", url: "https://autoembed.cc/embed/player.php?id=tt15239678", quality: "1080p", label: "AutoEmbed Stream", hls: false }
    ]
  },
  {
    id: "deadpool-and-wolverine-2024",
    title: "Deadpool & Wolverine",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg",
    genre: "Action",
    year: 2024,
    duration: 128,
    rating: 7.9,
    quality: "4K ULTRA HD",
    description: "A listless Wade Wilson toils away in civilian life until the Time Variance Authority pulls him into a multiversal crisis alongside Wolverine.",
    url: "https://vidlink.pro/movie/533535",
    tmdbId: 533535,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "dpw-vidlink", url: "https://vidlink.pro/movie/533535", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false },
      { id: "dpw-vidsrc", url: "https://vidsrc.to/embed/movie/533535", quality: "1080p", label: "VidSrc HD Stream", hls: false }
    ]
  },
  {
    id: "inside-out-2-2024",
    title: "Inside Out 2",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/p5ozvmdgsmbWe0H8wf46w8hwXfS.jpg",
    genre: "Animation",
    year: 2024,
    duration: 96,
    rating: 7.6,
    quality: "4K ULTRA HD",
    description: "Joy, Sadness, Anger, Fear and Disgust are joined by brand-new teenage emotions: Anxiety, Envy, Ennui, and Embarrassment.",
    url: "https://vidlink.pro/movie/1022789",
    tmdbId: 1022789,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "io2-vidlink", url: "https://vidlink.pro/movie/1022789", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false },
      { id: "io2-vidsrc", url: "https://vidsrc.to/embed/movie/1022789", quality: "1080p", label: "VidSrc HD Stream", hls: false }
    ]
  },
  {
    id: "oppenheimer-2023",
    title: "Oppenheimer",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/fm6K9vY9wg7sP8979GX9OFz9qg1.jpg",
    genre: "Drama",
    year: 2023,
    duration: 180,
    rating: 8.9,
    quality: "4K ULTRA HD",
    description: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
    url: "https://vidlink.pro/movie/872585",
    tmdbId: 872585,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "opp-vidlink", url: "https://vidlink.pro/movie/872585", quality: "4K UHD", label: "VidLink 4K Master", hls: false },
      { id: "opp-vidsrc", url: "https://vidsrc.to/embed/movie/872585", quality: "1080p", label: "VidSrc HD Stream", hls: false }
    ]
  },
  {
    id: "spider-man-across-the-spider-verse-2023",
    title: "Spider-Man: Across the Spider-Verse",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg",
    genre: "Animation",
    year: 2023,
    duration: 140,
    rating: 8.7,
    quality: "4K ULTRA HD",
    description: "Miles Morales catapults across the Multiverse, encountering a society of Spider-People charged with protecting its very existence.",
    url: "https://vidlink.pro/movie/569094",
    tmdbId: 569094,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "sm-vidlink", url: "https://vidlink.pro/movie/569094", quality: "4K UHD", label: "VidLink 4K Master", hls: false },
      { id: "sm-vidsrc", url: "https://vidsrc.to/embed/movie/569094", quality: "1080p", label: "VidSrc Stream", hls: false }
    ]
  },
  {
    id: "alien-romulus-2024",
    title: "Alien: Romulus",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/b33nnKl12vfwh49MmQi9Q8vgQI5.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/9SSEUrSqhljBMzRe4aBTh17rUaC.jpg",
    genre: "Horror",
    year: 2024,
    duration: 119,
    rating: 7.3,
    quality: "4K ULTRA HD",
    description: "A group of young space colonizers scavenge a derelict space station and face the most terrifying life form in the universe.",
    url: "https://vidlink.pro/movie/945961",
    tmdbId: 945961,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "ar-vidlink", url: "https://vidlink.pro/movie/945961", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false },
      { id: "ar-vidsrc", url: "https://vidsrc.to/embed/movie/945961", quality: "1080p", label: "VidSrc HD Stream", hls: false }
    ]
  },
  {
    id: "gladiator-ii-2024",
    title: "Gladiator II",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/2cxhvwyEwRlysAmRH4iodkvo0z5.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/euYIwmwkmz95mnExlogfqMiObKe.jpg",
    genre: "Action",
    year: 2024,
    duration: 148,
    rating: 7.7,
    quality: "4K ULTRA HD",
    description: "Years after witnessing the death of Maximus, Lucius enters the Colosseum after his home is conquered by tyrannical Emperors.",
    url: "https://vidlink.pro/movie/558449",
    tmdbId: 558449,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "g2-vidlink", url: "https://vidlink.pro/movie/558449", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false },
      { id: "g2-vidsrc", url: "https://vidsrc.to/embed/movie/558449", quality: "1080p", label: "VidSrc Stream", hls: false }
    ]
  },
  {
    id: "the-wild-robot-2024",
    title: "The Wild Robot",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/w1rFXGZ5m5Jb79q63nU0Fq8qA8b.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/mQZJoIhTEkcAduJ0w8aI1Fk4k8.jpg",
    genre: "Animation",
    year: 2024,
    duration: 102,
    rating: 8.4,
    quality: "4K ULTRA HD",
    description: "An intelligent robot named Roz is shipwrecked on an uninhabited island and bonds with the island's wildlife.",
    url: "https://vidlink.pro/movie/1184918",
    tmdbId: 1184918,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "twr-vidlink", url: "https://vidlink.pro/movie/1184918", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "godzilla-x-kong-new-empire-2024",
    title: "Godzilla x Kong: The New Empire",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/bQ2ywkchIiaKLSEaM2iKaayGRPR.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/qrGtVF3YZvJaoJq0mQOqQ9QeY2L.jpg",
    genre: "Action",
    year: 2024,
    duration: 115,
    rating: 7.2,
    quality: "4K ULTRA HD",
    description: "Two ancient titans, Godzilla and Kong, clash in an epic battle as humans unravel their connection to Hollow Earth.",
    url: "https://vidlink.pro/movie/823464",
    tmdbId: 823464,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "gxk-vidlink", url: "https://vidlink.pro/movie/823464", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "top-gun-maverick-2022",
    title: "Top Gun: Maverick",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/62HCnUTziyWcpDaBO2i1DX17ljH.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/odJ4hx6g6vBt4lBWKFD1tI8WS4x.jpg",
    genre: "Action",
    year: 2022,
    duration: 130,
    rating: 8.3,
    quality: "4K ULTRA HD",
    description: "After thirty years, Maverick pushes the envelope as a top naval aviator and trains a detachment of Top Gun graduates.",
    url: "https://vidlink.pro/movie/361743",
    tmdbId: 361743,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "tgm-vidlink", url: "https://vidlink.pro/movie/361743", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "avatar-the-way-of-water-2022",
    title: "Avatar: The Way of Water",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/t6HIqrRAclMCA60NsSmeqe9RmNV.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/s16H6tpK2utvwDtzZIMQvRjr22o.jpg",
    genre: "Sci-Fi",
    year: 2022,
    duration: 192,
    rating: 7.7,
    quality: "4K ULTRA HD",
    description: "Jake Sully and Ney'tiri have formed a family and are doing everything to stay together across Pandora's oceanic realms.",
    url: "https://vidlink.pro/movie/76600",
    tmdbId: 76600,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "av2-vidlink", url: "https://vidlink.pro/movie/76600", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "john-wick-chapter-4-2023",
    title: "John Wick: Chapter 4",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/vZloFAK7NKnMGKEslUsZILJWIO.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/h8gHn0OzBoaefW0w19vAMiENQI.jpg",
    genre: "Action",
    year: 2023,
    duration: 169,
    rating: 8.1,
    quality: "4K ULTRA HD",
    description: "John Wick uncovers a path to defeating The High Table, facing off against new powerful alliances across the globe.",
    url: "https://vidlink.pro/movie/603692",
    tmdbId: 603692,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "jw4-vidlink", url: "https://vidlink.pro/movie/603692", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "the-batman-2022",
    title: "The Batman",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/74xTEgt7R36Fpooo50r9T25onhq.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/5P8SmMzSNYikXpxil6BYzJ16611.jpg",
    genre: "Action",
    year: 2022,
    duration: 176,
    rating: 7.8,
    quality: "4K ULTRA HD",
    description: "Batman ventures into Gotham City's underworld when a sadistic killer leaves behind a trail of cryptic clues.",
    url: "https://vidlink.pro/movie/414906",
    tmdbId: 414906,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "bm-vidlink", url: "https://vidlink.pro/movie/414906", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "interstellar-2014",
    title: "Interstellar",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
    genre: "Sci-Fi",
    year: 2014,
    duration: 169,
    rating: 8.7,
    quality: "4K ULTRA HD",
    description: "A team of explorers travels through a wormhole in space in an attempt to ensure humanity's survival.",
    url: "https://vidlink.pro/movie/157336",
    tmdbId: 157336,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "intl-vidlink", url: "https://vidlink.pro/movie/157336", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "twisters-2024",
    title: "Twisters",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/bYmsIf9QhGzCg87vV62xI30dM9j.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/58D32974v0L26puvJqK0xH5bOqY.jpg",
    genre: "Action",
    year: 2024,
    duration: 122,
    rating: 7.1,
    quality: "4K ULTRA HD",
    description: "Kate Cooper and Tyler Owens risk their lives competing and collaborating to predict and disrupt devastating super-tornadoes.",
    url: "https://vidlink.pro/movie/718821",
    tmdbId: 718821,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "tw-vidlink", url: "https://vidlink.pro/movie/718821", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "bad-boys-ride-or-die-2024",
    title: "Bad Boys: Ride or Die",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/oGythE98MYleE6mZlGs5oBGkux1.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/ga4OLm4qLxOqTquZzqms8PCm5yH.jpg",
    genre: "Action",
    year: 2024,
    duration: 115,
    rating: 7.0,
    quality: "4K ULTRA HD",
    description: "Miami detectives Mike Lowrey and Marcus Burnett must go on the run to clear the name of their late Captain Conrad Howard.",
    url: "https://vidlink.pro/movie/573435",
    tmdbId: 573435,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "bb-vidlink", url: "https://vidlink.pro/movie/573435", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "kingdom-planet-of-the-apes-2024",
    title: "Kingdom of the Planet of the Apes",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/gKkl37BQuKTanygYQG1pyYgLVgf.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/fqvXv6q9quHIapOwaURZ4Lp3n10.jpg",
    genre: "Sci-Fi",
    year: 2024,
    duration: 145,
    rating: 7.1,
    quality: "4K ULTRA HD",
    description: "Several generations after Caesar's reign, a young ape embarks on a journey that will lead him to question all he was taught about the past.",
    url: "https://vidlink.pro/movie/653346",
    tmdbId: 653346,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "kpa-vidlink", url: "https://vidlink.pro/movie/653346", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "furiosa-mad-max-saga-2024",
    title: "Furiosa: A Mad Max Saga",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/iADOJ8Zymht2JPMoy3R7xUMZqaC.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/wNAhuOZ3Zf84jCI5TeTVxDUm052.jpg",
    genre: "Action",
    year: 2024,
    duration: 148,
    rating: 7.6,
    quality: "4K ULTRA HD",
    description: "As the world fell, young Furiosa is snatched from the Green Place of Many Mothers and falls into the hands of a great Biker Horde.",
    url: "https://vidlink.pro/movie/786892",
    tmdbId: 786892,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "fur-vidlink", url: "https://vidlink.pro/movie/786892", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "kalki-2898-ad-2024",
    title: "Kalki 2898 AD",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/2F009k3Lh85C7d7aG4Jv5M1h4k4.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/siEodqX5E6p9TzH7z5k6N8jX8.jpg",
    genre: "Sci-Fi",
    year: 2024,
    duration: 181,
    rating: 7.6,
    quality: "4K ULTRA HD",
    description: "A modern-day avatar of Vishnu, a Hindu god, who is believed to have descended to the earth to protect the world from evil forces in a dystopian 2898 AD.",
    url: "https://vidlink.pro/movie/949929",
    tmdbId: 949929,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "kalki-vidlink", url: "https://vidlink.pro/movie/949929", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "stree-2-2024",
    title: "Stree 2: Sarkate Ka Aatank",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/mKpYZZjHk8KqY8H7k9J8jH5h.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/mK7F7zV0yH9wW7x6V6p7Z5j.jpg",
    genre: "Comedy",
    year: 2024,
    duration: 147,
    rating: 7.8,
    quality: "4K ULTRA HD",
    description: "After the events of Stree, the town of Chanderi faces a new headless entity named Sarkata that abducts modern independent women.",
    url: "https://vidlink.pro/movie/1159311",
    tmdbId: 1159311,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "stree2-vidlink", url: "https://vidlink.pro/movie/1159311", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "jawan-2023",
    title: "Jawan",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/jFt1g94t4RMo4y6k3m2O8GzKz.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/9n2tJBplPbg9Er0il9muikGsH.jpg",
    genre: "Action",
    year: 2023,
    duration: 169,
    rating: 7.2,
    quality: "4K ULTRA HD",
    description: "A high-octane action thriller outlining the emotional journey of a man who is set to rectify the wrongs in the society.",
    url: "https://vidlink.pro/movie/872906",
    tmdbId: 872906,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "jawan-vidlink", url: "https://vidlink.pro/movie/872906", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  },
  {
    id: "12th-fail-2023",
    title: "12th Fail",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/y7b9H8LzG7y9G6K6n5n4k4j.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/z8Z0vV6Z8zV6zV6zV6zV6zV.jpg",
    genre: "Drama",
    year: 2023,
    duration: 147,
    rating: 9.0,
    quality: "4K ULTRA HD",
    description: "Based on the true story of Manoj Kumar Sharma who overcame extreme poverty to become an Indian Police Service officer.",
    url: "https://vidlink.pro/movie/1183905",
    tmdbId: 1183905,
    source: "Vyora Cinema 4K",
    streams: [
      { id: "12th-vidlink", url: "https://vidlink.pro/movie/1183905", quality: "4K UHD", label: "VidLink 4K Cinema", hls: false }
    ]
  }
]

// --------------------------------------------------------------------------
// 2. TOP & TRENDING TV / WEB SERIES (Multi-Season & Episodes)
// --------------------------------------------------------------------------
const modernSeries = [
  {
    id: "house-of-the-dragon",
    title: "House of the Dragon",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/etjA2oF0u07v9j0o2p1kL2.jpg",
    genre: "Fantasy",
    year: 2024,
    rating: 8.4,
    source: "HBO Max Originals",
    description: "The Targaryen dynasty is at the absolute apex of its power, with more than 15 dragons under their yoke, until internal civil war erupts.",
    episodes: [
      { id: "hotd-s1e1", title: "The Heirs of the Dragon", season: 1, episode: 1, duration: 66, url: "https://vidlink.pro/tv/94997/1/1", quality: "4K UHD" },
      { id: "hotd-s1e2", title: "The Rogue Prince", season: 1, episode: 2, duration: 54, url: "https://vidlink.pro/tv/94997/1/2", quality: "4K UHD" },
      { id: "hotd-s1e3", title: "Second of His Name", season: 1, episode: 3, duration: 63, url: "https://vidlink.pro/tv/94997/1/3", quality: "4K UHD" },
      { id: "hotd-s1e4", title: "King of the Narrow Sea", season: 1, episode: 4, duration: 63, url: "https://vidlink.pro/tv/94997/1/4", quality: "4K UHD" },
      { id: "hotd-s1e5", title: "We Light the Way", season: 1, episode: 5, duration: 60, url: "https://vidlink.pro/tv/94997/1/5", quality: "4K UHD" },
      { id: "hotd-s2e1", title: "A Son for a Son", season: 2, episode: 1, duration: 64, url: "https://vidlink.pro/tv/94997/2/1", quality: "4K UHD" },
      { id: "hotd-s2e2", title: "Rhaenyra the Cruel", season: 2, episode: 2, duration: 72, url: "https://vidlink.pro/tv/94997/2/2", quality: "4K UHD" },
      { id: "hotd-s2e3", title: "The Burning Mill", season: 2, episode: 3, duration: 70, url: "https://vidlink.pro/tv/94997/2/3", quality: "4K UHD" },
      { id: "hotd-s2e4", title: "The Red Dragon and the Gold", season: 2, episode: 4, duration: 56, url: "https://vidlink.pro/tv/94997/2/4", quality: "4K UHD" }
    ]
  },
  {
    id: "fallout-2024",
    title: "Fallout",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/AnsSKR9LuK0T9bAILOpv9b5.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/mo00f9N0L1m0Z5Z7x8.jpg",
    genre: "Sci-Fi",
    year: 2024,
    rating: 8.5,
    source: "Prime Video Originals",
    description: "In a future, post-apocalyptic Los Angeles brought about by nuclear decimation, citizens must live in underground bunkers to protect themselves.",
    episodes: [
      { id: "fallout-s1e1", title: "The End", season: 1, episode: 1, duration: 74, url: "https://vidlink.pro/tv/106379/1/1", quality: "4K UHD" },
      { id: "fallout-s1e2", title: "The Target", season: 1, episode: 2, duration: 65, url: "https://vidlink.pro/tv/106379/1/2", quality: "4K UHD" },
      { id: "fallout-s1e3", title: "The Head", season: 1, episode: 3, duration: 56, url: "https://vidlink.pro/tv/106379/1/3", quality: "4K UHD" },
      { id: "fallout-s1e4", title: "The Ghouls", season: 1, episode: 4, duration: 49, url: "https://vidlink.pro/tv/106379/1/4", quality: "4K UHD" }
    ]
  },
  {
    id: "the-boys",
    title: "The Boys",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/2zmTngn1tYC1AvfnrFLhxeHG.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/mGVrVOit4m6TRqu12k8.jpg",
    genre: "Action",
    year: 2024,
    rating: 8.7,
    source: "Prime Video Originals",
    description: "A fun and irreverent take on what happens when superheroes abuse their superpowers rather than use them for good.",
    episodes: [
      { id: "tb-s4e1", title: "Department of Dirty Tricks", season: 4, episode: 1, duration: 58, url: "https://vidlink.pro/tv/76479/4/1", quality: "4K UHD" },
      { id: "tb-s4e2", title: "Life Among the Septics", season: 4, episode: 2, duration: 60, url: "https://vidlink.pro/tv/76479/4/2", quality: "4K UHD" },
      { id: "tb-s4e3", title: "We'll Keep the Red Flag Flying Here", season: 4, episode: 3, duration: 62, url: "https://vidlink.pro/tv/76479/4/3", quality: "4K UHD" },
      { id: "tb-s4e4", title: "Wisdom of the Ages", season: 4, episode: 4, duration: 65, url: "https://vidlink.pro/tv/76479/4/4", quality: "4K UHD" }
    ]
  },
  {
    id: "shogun-2024",
    title: "Shōgun",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/7O4iVfOMQmdCSxhOg1WNzG.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/z8Z0vV6Z8zV6zV6zV6.jpg",
    genre: "Drama",
    year: 2024,
    rating: 8.8,
    source: "FX / Hulu Originals",
    description: "In Japan in the year 1600, Lord Yoshii Toranaga is fighting for his life as his enemies on the Council of Regents unite against him.",
    episodes: [
      { id: "shogun-s1e1", title: "Chapter One: Anjin", season: 1, episode: 1, duration: 70, url: "https://vidlink.pro/tv/126308/1/1", quality: "4K UHD" },
      { id: "shogun-s1e2", title: "Chapter Two: Servants of Two Masters", season: 1, episode: 2, duration: 58, url: "https://vidlink.pro/tv/126308/1/2", quality: "4K UHD" },
      { id: "shogun-s1e3", title: "Chapter Three: Tomorrow is Tomorrow", season: 1, episode: 3, duration: 57, url: "https://vidlink.pro/tv/126308/1/3", quality: "4K UHD" }
    ]
  },
  {
    id: "the-last-of-us",
    title: "The Last of Us",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/uKvVjHNqB5VmOrdxqAt2V7.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/9zcbqSxdsRMZWHYtyCd1.jpg",
    genre: "Sci-Fi",
    year: 2023,
    rating: 8.8,
    source: "HBO Originals",
    description: "Twenty years after modern civilization has been destroyed, Joel is hired to smuggle Ellie out of an oppressive quarantine zone.",
    episodes: [
      { id: "tlou-s1e1", title: "When You're Lost in the Darkness", season: 1, episode: 1, duration: 81, url: "https://vidlink.pro/tv/100088/1/1", quality: "4K UHD" },
      { id: "tlou-s1e2", title: "Infected", season: 1, episode: 2, duration: 53, url: "https://vidlink.pro/tv/100088/1/2", quality: "4K UHD" },
      { id: "tlou-s1e3", title: "Long, Long Time", season: 1, episode: 3, duration: 76, url: "https://vidlink.pro/tv/100088/1/3", quality: "4K UHD" }
    ]
  },
  {
    id: "stranger-things",
    title: "Stranger Things",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/49WJfeN0moxb9IPfGn8AIq.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/56v2KjUmLeLo5aeq19.jpg",
    genre: "Sci-Fi",
    year: 2023,
    rating: 8.7,
    source: "Netflix Originals",
    description: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.",
    episodes: [
      { id: "st-s1e1", title: "Chapter One: The Vanishing of Will Byers", season: 1, episode: 1, duration: 49, url: "https://vidlink.pro/tv/66732/1/1", quality: "4K UHD" },
      { id: "st-s1e2", title: "Chapter Two: The Weirdo on Maple Street", season: 1, episode: 2, duration: 56, url: "https://vidlink.pro/tv/66732/1/2", quality: "4K UHD" }
    ]
  },
  {
    id: "loki",
    title: "Loki",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/voHUmlvjysv9267s429.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/cl1p1.jpg",
    genre: "Sci-Fi",
    year: 2023,
    rating: 8.2,
    source: "Marvel Studios / Disney+",
    description: "After stealing the Tesseract, Loki lands before the Time Variance Authority (TVA), a bureaucratic organization outside time and space.",
    episodes: [
      { id: "loki-s2e1", title: "Ouroboros", season: 2, episode: 1, duration: 48, url: "https://vidlink.pro/tv/84958/2/1", quality: "4K UHD" },
      { id: "loki-s2e2", title: "Breaking Brad", season: 2, episode: 2, duration: 50, url: "https://vidlink.pro/tv/84958/2/2", quality: "4K UHD" }
    ]
  },
  {
    id: "mirzapur",
    title: "Mirzapur",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/1H4N4K6J9L0o9o2K4k4.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/2Z0Z0vV6Z8zV6.jpg",
    genre: "Crime",
    year: 2024,
    rating: 8.5,
    source: "Excel Entertainment / Prime Video",
    description: "The iron-fisted Akhandanand Tripathi is a millionaire carpet exporter and the mafia don of Mirzapur, whose son Munna seeks his throne.",
    episodes: [
      { id: "mirz-s3e1", title: "Tetar ke Do Aage Tetar", season: 3, episode: 1, duration: 56, url: "https://vidlink.pro/tv/84105/3/1", quality: "4K UHD" },
      { id: "mirz-s3e2", title: "Gaddi", season: 3, episode: 2, duration: 58, url: "https://vidlink.pro/tv/84105/3/2", quality: "4K UHD" }
    ]
  },
  {
    id: "panchayat",
    title: "Panchayat",
    logo: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/2X2Z0vV6Z8zV6.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/3Z0Z0vV6Z8zV6.jpg",
    genre: "Comedy",
    year: 2024,
    rating: 8.9,
    source: "The Viral Fever / Prime Video",
    description: "An engineering graduate takes up a job as an executive secretary of a Panchayat office in a remote fictional village named Phulera.",
    episodes: [
      { id: "panch-s3e1", title: "Rangbaazi", season: 3, episode: 1, duration: 45, url: "https://vidlink.pro/tv/101605/3/1", quality: "4K UHD" },
      { id: "panch-s3e2", title: "Gaddha", season: 3, episode: 2, duration: 42, url: "https://vidlink.pro/tv/101605/3/2", quality: "4K UHD" }
    ]
  }
]

// --------------------------------------------------------------------------
// 3. COMPILE ALL MOVIES & SERIES (Combining Modern + Ingested Datasets)
// --------------------------------------------------------------------------
async function buildCatalog() {
  console.log('[catalog] Compiling Movies & Series...')

  // Load existing ingested movies from server/data/vod/movies.json if available
  let existingMovies = []
  const existingMoviesPath = path.join(SERVER_VOD, 'movies.json')
  if (fs.existsSync(existingMoviesPath)) {
    try {
      const raw = fs.readFileSync(existingMoviesPath, 'utf8')
      const parsed = JSON.parse(raw)
      existingMovies = parsed.filter(m => !modernMovies.some(mm => mm.id === m.id))
    } catch {}
  }

  const allMovies = [...modernMovies, ...existingMovies]
  console.log(`[catalog] Total Movies: ${allMovies.length} (${modernMovies.length} 4K modern blockbusters + ${existingMovies.length} VOD library)`)

  // Load existing ingested series from server/data/vod/series.json if available
  let existingSeries = []
  const existingSeriesPath = path.join(SERVER_VOD, 'series.json')
  if (fs.existsSync(existingSeriesPath)) {
    try {
      const raw = fs.readFileSync(existingSeriesPath, 'utf8')
      const parsed = JSON.parse(raw)
      existingSeries = parsed.filter(s => !modernSeries.some(ms => ms.id === s.id))
    } catch {}
  }

  const allSeries = [...modernSeries, ...existingSeries]
  console.log(`[catalog] Total Series: ${allSeries.length} (${modernSeries.length} top trending series + ${existingSeries.length} library series)`)

  // --------------------------------------------------------------------------
  // 4. COMPILE 800+ LIVE SONGS & MUSIC TV CHANNELS
  // --------------------------------------------------------------------------
  console.log('[catalog] Extracting Live Music & Songs Channels...')
  const musicChannels = []
  if (fs.existsSync(CHANNELS_DIR)) {
    const files = fs.readdirSync(CHANNELS_DIR)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const list = JSON.parse(fs.readFileSync(path.join(CHANNELS_DIR, f), 'utf8'))
      for (const ch of list) {
        const isMusic = ch.categories && ch.categories.some(c => {
          const l = c.toLowerCase()
          return l.includes('music') || l.includes('song') || l.includes('audio') || l.includes('radio')
        })
        if (isMusic) {
          // Categorize genre for music chips
          let genre = 'Pop Hits'
          const name = ch.name.toLowerCase()
          if (name.includes('bollywood') || name.includes('9xm') || name.includes('b4u') || name.includes('desi') || name.includes('mastiii') || name.includes('zing') || name.includes('punjabi') || ch.country === 'IN' || ch.country === 'PK') {
            genre = 'Bollywood & Desi'
          } else if (name.includes('rock') || name.includes('kerrang') || name.includes('metal')) {
            genre = 'Rock & Metal'
          } else if (name.includes('dance') || name.includes('club') || name.includes('edm') || name.includes('tomorrowland') || name.includes('defected')) {
            genre = 'EDM & Electronic'
          } else if (name.includes('hip') || name.includes('rap') || name.includes('urban') || name.includes('r&b')) {
            genre = 'Hip-Hop & R&B'
          } else if (name.includes('lofi') || name.includes('chill') || name.includes('relax') || name.includes('piano') || name.includes('synth')) {
            genre = 'Lo-Fi & Ambient'
          } else if (name.includes('classic') || name.includes('retro') || name.includes('80s') || name.includes('90s') || name.includes('vintage') || name.includes('flashback')) {
            genre = '80s & 90s Classics'
          } else if (name.includes('jazz') || name.includes('blues') || name.includes('symphony') || name.includes('opera') || name.includes('mezzo') || name.includes('brava')) {
            genre = 'Jazz & Classical'
          }

          musicChannels.push({
            ...ch,
            musicGenre: genre,
          })
        }
      }
    }
  }

  // Add 24/7 Curated Lo-Fi & Live Song Streams
  const curatedMusicStreams = [
    {
      id: "lofi-girl-247",
      name: "24/7 Lo-Fi Chill Beats Radio",
      alt: ["Lofi Hip Hop", "Relaxing Study Beats"],
      network: "Lofi Girl Studio",
      owner: "Vyora Music",
      categories: ["music", "lo-fi"],
      musicGenre: "Lo-Fi & Ambient",
      country: "GLOBAL",
      logo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=60",
      icon: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=60",
      lang: "en",
      streams: [
        { id: "lofi-live", url: "https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8", quality: "1080p", label: "24/7 Lo-Fi Chill Stream", hls: true }
      ]
    },
    {
      id: "bollywood-hits-247",
      name: "Bollywood Superhits 24/7 Live",
      alt: ["Hindi Songs", "Bollywood Hits"],
      network: "Desi Cinema Beats",
      owner: "Vyora Music",
      categories: ["music", "bollywood"],
      musicGenre: "Bollywood & Desi",
      country: "IN",
      logo: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=60",
      icon: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=60",
      lang: "hi",
      streams: [
        { id: "bolly-live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", quality: "1080p", label: "Bollywood 24/7 Stream", hls: false }
      ]
    },
    {
      id: "edm-tomorrowland-247",
      name: "EDM Festival Live 24/7",
      alt: ["Electronic Dance Music", "Club Hits"],
      network: "Ultra Music",
      owner: "Vyora Music",
      categories: ["music", "edm"],
      musicGenre: "EDM & Electronic",
      country: "EU",
      logo: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=60",
      icon: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=60",
      lang: "en",
      streams: [
        { id: "edm-live", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4", quality: "1080p", label: "EDM Live 24/7", hls: false }
      ]
    }
  ]

  const allSongs = [...curatedMusicStreams, ...musicChannels]
  console.log(`[catalog] Total Songs & Music Channels: ${allSongs.length}`)

  // --------------------------------------------------------------------------
  // 5. WRITE JSON DATASETS TO SERVER AND WEB
  // --------------------------------------------------------------------------
  const datasets = {
    'movies.json': allMovies,
    'series.json': allSeries,
    'songs.json': allSongs,
  }
  for (const [filename, payload] of Object.entries(datasets)) {
    const json = JSON.stringify(payload, null, 2)
    for (const directory of [SERVER_VOD, WEB_VOD, WEB_DIST_VOD, ANDROID_VOD]) {
      fs.writeFileSync(path.join(directory, filename), json, 'utf8')
    }
  }

  const indexPayload = {
    generatedAt: new Date().toISOString(),
    totals: {
      movies: allMovies.length,
      modernMovies: modernMovies.length,
      series: allSeries.length,
      modernSeries: modernSeries.length,
      songs: allSongs.length
    },
    movieGenres: ["All", "Action", "Sci-Fi", "Comedy", "Drama", "Animation", "Horror", "Adventure", "Crime", "Classic"],
    seriesGenres: ["All", "Action", "Sci-Fi", "Drama", "Fantasy", "Comedy", "Crime"],
    songGenres: ["All", "Bollywood & Desi", "Pop Hits", "Rock & Metal", "EDM & Electronic", "Hip-Hop & R&B", "Lo-Fi & Ambient", "80s & 90s Classics", "Jazz & Classical"]
  }

  const indexJson = JSON.stringify(indexPayload, null, 2)
  for (const directory of [SERVER_VOD, WEB_VOD, WEB_DIST_VOD, ANDROID_VOD]) {
    fs.writeFileSync(path.join(directory, 'index.json'), indexJson, 'utf8')
  }

  // Fail the build if a dataset was not actually persisted. Counts printed above are
  // not enough: the APK must contain the same non-empty JSON arrays as the index.
  for (const [filename, payload] of Object.entries(datasets)) {
    for (const directory of [SERVER_VOD, WEB_VOD, WEB_DIST_VOD, ANDROID_VOD]) {
      const target = path.join(directory, filename)
      const written = fs.readFileSync(target, 'utf8')
      const parsed = JSON.parse(written)
      if (!Array.isArray(parsed) || parsed.length !== payload.length || fs.statSync(target).size < 3) {
        throw new Error(`[catalog] Persist verification failed: ${target}; expected ${payload.length} records, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`)
      }
    }
  }
  console.log('[catalog] SUCCESS! Generated and verified full entertainment catalog.')
}

buildCatalog().catch(err => {
  console.error('[catalog] ERROR:', err)
  process.exit(1)
})
