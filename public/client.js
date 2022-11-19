/* globals io, tests, eq json2csv, Vue*/

function nameFromUrl(urlstring) {
  // returns username without @
  let name = "";
  // https://host.tld/@name host.tld/web/@name/
  // not a proper domain host.tld/@name
  if (urlstring.includes("@"))
    name = urlstring
      .split(/\/|\?/)
      .filter((urlparts) => urlparts.includes("@"))[0]
      .replace("@", "");
  // friendica: sub.domain.tld/profile/name
  else if (urlstring.includes("/profile/"))
    name = urlstring.split("/profile/").slice(-1)[0].replace(/\/+$/, "");
  // diaspora: domain.tld/u/name
  else if (urlstring.includes("/u/"))
    name = urlstring.split("/u/").slice(-1)[0].replace(/\/+$/, "");
  // peertube: domain.tld/u/name
  else if (/\/c\/|\/a\//.test(urlstring))
    name = urlstring
      .split(/\/c\/|\/a\//)
      .slice(-1)[0]
      .split("/")[0];
  else {
    console.log(`didn't find name in ${urlstring}`);
  }
  return name;
}

function handleFromUrl(urlstring) {
  // transform an URL-like string into a fediverse handle: @name@server.tld
  let name = nameFromUrl(urlstring);
  if (urlstring.match(/^http/i)) {
    // proper url
    let handleUrl = new URL(urlstring);
    return `@${name}@${handleUrl.host}`;
  } else {
    // not a proper URL
    let domain = urlstring.split("/")[0];
    return `@${name}@${domain}`;
  }
}

function findHandles(text) {
  // split text into string and check them for handles

  // remove weird characters and unicode font stuff
  text = text
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n@\.^$]/gu, " ")
    .toLowerCase()
    .normalize("NFKD");

  // different separators people use
  let words = text.split(/,|\s|“|#|\(|\)|'|》|\?|\n|\r|\t|・|\||…|\.\s|\s$/);

  // remove common false positives
  let unwanted_domains =
    /gmail\.com(?:$|\/)|mixcloud|linktr\.ee(?:$|\/)|pinboardxing\.com(?:$|\/)|researchgate|about|bit\.ly(?:$|\/)|imprint|impressum|patreon|donate|blog|facebook|news|github|instagram|t\.me(?:$|\/)|medium\.com(?:$|\/)|t\.co(?:$|\/)|tiktok\.com(?:$|\/)|youtube\.com(?:$|\/)|pronouns\.page(?:$|\/)|mail@|observablehq|twitter\.com(?:$|\/)|contact@|kontakt@|protonmail|traewelling\.de(?:$|\/)|press@|support@|info@|pobox|hey\.com(?:$|\/)/;
  words = words.filter((word) => !unwanted_domains.test(word));
  words = words.filter((w) => w);

  let handles = [];

  words.map((word) => {
    // @username@server.tld
    if (/^@[a-zA-Z0-9_]+@.+\.[a-zA-Z]+$/.test(word)) handles.push(word);
    // some people don't include the initial @
    else if (/^[a-zA-Z0-9_]+@.+\.[a-zA-Z|]+$/.test(word))
      handles.push(`@${word}`);
    // server.tld/@username
    // friendica: sub.domain.tld/profile/name
    else if (
      /^.+\.[a-zA-Z]+.*\/(@|web\/|profile\/|\/u\/|\/c\/)[a-zA-Z0-9_]+\/*$/.test(
        word
      )
    )
      handles.push(handleFromUrl(word));

    // experimental. domain.tld/name. too many false positives
    // pleroma, snusocial
    //else if (/^.+\.[a-zA-Z]+\/[a-zA-Z_]+\/?$/.test(word)) console.log(word);
  });
  return [...new Set(handles)];
}

const app = Vue.createApp({
  data() {
    return {
      scan_count: 0,
      unqiue_count: 0,
      followed_count: 0,
      broken_count: 0,
      unchecked_domains_count: 0,
      profile: null,
      user_lists: [],
      accounts: [],
      domains: {},
      known_instances: {},
      unchecked_domains: [],
      lookup_server: false,
      twitter_auth: false,
    };
  },
  computed: {},
  methods: {
    processAccount(type, user) {
      let followings, follower, list;

      // get list name from local user_lists
      type.type == "list"
        ? (list = this.user_lists.filter(
            (list) => list.id_str == type.list_id
          )[0].name)
        : null;
      type.type == "followers" ? (follower = true) : null;
      type.type == "followings" ? (followings = true) : null;

      if (user.username in this.accounts) {
        this.accounts[user.username].following = this.accounts[user.username]
          .following
          ? this.accounts[user.username].following
          : followings;
        this.accounts[user.username].follower = this.accounts[user.username]
          .follower
          ? this.accounts[user.username].follower
          : follower;
        type.type == "list"
          ? this.accounts[user.username].lists.push(list)
          : this.accounts[user.username].lists;
      } else {
        this.scan_count += 1;

        let text = `${user["name"]} ${user["description"]} ${
          user["location"]
        } ${user["pinned_tweet"]} ${user["urls"].join(" ")}`;

        let handles = findHandles(text);

        this.accounts[user.username] = {
          name: user.name,
          following: followings,
          follower: follower,
          lists: [list],
          handles: handles,
          location: user.location,
          description: user.description,
          urls: user.urls,
          pinned_tweet: user.pinned_tweet,
        };
        this.addHandles(user.username, handles);
        this.removeDuplicates();
      }
    },
    addHandles(username, handles) {
      // add handles to domains list
      if (handles.length > 0) {
        handles.forEach((handle) => {
          let domain = handle.split("@").slice(-1)[0];

          // add to domains obj
          if (domain in this.domains) {
            this.domains[domain]["handles"].push({
              username: username,
              handle: handle,
            });
          } else
            this.domains[domain] = {
              handles: [{ username: username, handle: handle }],
            };
        });
      }
    },
    removeDuplicates() {
      for (const [domain, data] of Object.entries(this.domains)) {
        if ("handles" in this.domains[domain]) {
          this.domains[domain]["handles"] = [
            ...new Map(
              this.domains[domain]["handles"].map((v) => [v.handle, v])
            ).values(),
          ];
        }
      }
    },
    checkDomains() {
      // send unchecked domains to server to get more info
      for (const [domain, data] of Object.entries(this.domains)) {
        if ("part_of_fediverse" in data === false) {
          if (domain in this.known_instances) {
            // add info from cached instance data
            this.domains[domain] = Object.assign(
              {},
              this.domains[domain],
              this.known_instances[domain]
            );
          } else {
            // get new info from server
            this.unchecked_domains.push({
              domain: domain,
              handle: data["handles"][0]["handle"],
            });
          }
        }
      }
      if (this.unchecked_domains.length > 0) {
        let server = "";
        this.lookup_server ? (server = this.lookup_server) : null;

        this.unchecked_domains.forEach((domain) =>
          fetch(`${server}/api/check?handle=${domain.handle}&${domain.domain}`)
            .then((response) => response.json())
            .then((data) => this.processCheckedDomain(data))
        );
      }
    },
    processCheckedDomain(data) {
      // add info about domains
      console.log(data)
      this.unchecked_domains = this.unchecked_domains.filter(
        (item) => item != data["domain"]
      );
      this.domains[data["domain"]] = Object.assign(
        {},
        this.domains[data["domain"]],
        data
      );
    },
    logoff() {
      localStorage.clear();
      window.location.href = "/logoff";
    },
    loadProfile() {
      fetch("/api/getProfile")
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            console.log(data);
          } else {
            this.profile = data;
            this.processAccount("me", data);
          }
        });
    },
    loadFollowings() {
      fetch("/api/getFollowings")
        .then((response) => response.json())
        .then((data) => {
          if ("error" in data) {
            console.log(data);
          } else {
            data.accounts.map((user) =>
              this.processAccount("followings", user)
            );
            this.checkDomains();
          }
        });
    },
  },
  mounted() {
    if (window.location.href.indexOf("#t") !== -1) {
      localStorage.setItem("twitterAuth", true);
      window.location.hash = "";
    }
    if (localStorage.getItem("twitterAuth")) {
      this.twitter_auth = true;
      this.loadProfile();
      this.loadFollowings();
    }
  },
});

app.mount("#fedifinder");
