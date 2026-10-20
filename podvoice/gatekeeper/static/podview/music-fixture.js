// Real track metadata from Spotify oEmbed, verified 15 October 2026.
// Local scenario membership/order and playback receipts are simulated, not account history.
export const MUSIC_FIXTURE = [
  {
    "id": "heartless",
    "title": "Heartless",
    "artist": "Kanye West",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b273346d77e155d854735410ed18",
    "uri": "spotify:track:4EWCNWgDS8707fNSZ1oaA5",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/4EWCNWgDS8707fNSZ1oaA5"
  },
  {
    "id": "end-of-beginning",
    "title": "End of Beginning",
    "artist": "Djo",
    "art": "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02da27026597de2d0d940990d2",
    "uri": "spotify:track:6ZWIIawlXC4O3z9yEuJvDo",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/6ZWIIawlXC4O3z9yEuJvDo"
  },
  {
    "id": "cruel-summer",
    "title": "Cruel Summer",
    "artist": "Taylor Swift",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02e787cffec20aa2a396a61647",
    "uri": "spotify:track:1BxfuPKGuaTgP7aM0Bbdwr",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/1BxfuPKGuaTgP7aM0Bbdwr"
  },
  {
    "id": "flowers",
    "title": "Flowers",
    "artist": "Miley Cyrus",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0266fd0917f38d472c8576754e",
    "uri": "spotify:track:7DSAEUvxU8FajXtRloy8M0",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/7DSAEUvxU8FajXtRloy8M0"
  },
  {
    "id": "without-me",
    "title": "Without Me",
    "artist": "Eminem",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e023686f349e17589993adacddd",
    "uri": "spotify:track:1I1wdcCLTUe8qeg8NGICq0",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/1I1wdcCLTUe8qeg8NGICq0"
  },
  {
    "id": "lost",
    "title": "Lost",
    "artist": "Frank Ocean",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e027aede4855f6d0d738012e2e5",
    "uri": "spotify:track:3GZD6HmiNUhxXYf8Gch723",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/3GZD6HmiNUhxXYf8Gch723"
  },
  {
    "id": "get-lucky",
    "title": "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
    "artist": "Daft Punk, Pharrell Williams, Nile Rodgers",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0219a88dd5c7118e87d7b1619e",
    "uri": "spotify:track:2Foc5Q5nqNiosCNqttzHof",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof"
  },
  {
    "id": "take-five",
    "title": "Take Five",
    "artist": "The Dave Brubeck Quartet",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e029a5cf8ee22fc7ee02ad3478e",
    "uri": "spotify:track:0iyks4WPAIxXTVhM8dMTpm",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/0iyks4WPAIxXTVhM8dMTpm"
  },
  {
    "id": "via-con-me",
    "title": "Via con me",
    "artist": "Paolo Conte",
    "art": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e0260b2bff12b9c6b25b67876e3",
    "uri": "spotify:track:1pyRIDt1KO8vYEnB2EoYTx",
    "fixture": true,
    "metadataSource": "https://open.spotify.com/track/1pyRIDt1KO8vYEnB2EoYTx"
  }
];

// Simulated native-owner receipt for localhost only. Never used by live controls.
// Mirrors the existing PodConnect Speakers fixed-start policy; the real owner remains PodConnect.
export const MOCK_PLAYBACK_POLICY=Object.freeze({owner:"podconnect-speakers-fixture",startVolumePercent:35});
