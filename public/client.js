/* globals io, username, tests, eq profile json2csv*/

const socket = io();
let accounts = {};
let domains = {};
let checked_accounts = 0;
let user_lists = [];
let unchecked_domains = [];
let display_brokenList = "none";
let displayBroken = "inline";
let user_handles = [];
let displayButtons = true;

$(function () {
  // run after everything is loaded
  let text = user_to_text(profile);
  "pinnedTweet" in profile
    ? (text += " " + tweet_to_text(profile.pinnedTweet))
    : "";
  user_handles = [...new Set(findHandles(text))];

  if (user_handles.length > 0) {
    $("#userHandles").append(
      $("<p>").text(`These handles were found in your profile @${username}`)
    );
    $("#userHandles").append($("<ul>"));

    user_handles.forEach((handle) => {
      let import_url = handle.split("@")[2] + "/settings/import";
      $("#userHandles ul").append(
        $("<li>")
          .text(handle)
          .append("<br>(After exporting the CSV, import it at ")
          .append(
            $("<a>")
              .attr("href", "https://" + import_url)
              .attr("target", "_blank")
              .text(import_url)
          )
          .append(")")
      );
    });
    $("#displayFollowButtons").css("display", "block");
  } else {
    $("#userHandles").text(
      `No handles were found on your profile @${username}. Please use the format @name@host.tld or https://host.tld/@name`
    );
  }
});

function removeDuplicates() {
  for (const [domain, data] of Object.entries(domains)) {
    if ("handles" in domains[domain]) {
      domains[domain]["handles"] = [
        ...new Map(
          domains[domain]["handles"].map((v) => [v.handle, v])
        ).values(),
      ];
    }
  }
}

function addHandles(username, handles) {
  // add handles to domains list
  if (handles.length > 0) {
    handles.forEach((handle) => {
      let domain = handle.split("@").slice(-1)[0];
      if (domain in domains) {
        domains[domain]["handles"].push({
          username: username,
          handle: handle,
        });
      } else
        domains[domain] = {
          handles: [{ username: username, handle: handle }],
        };
    });
  }
}

function retryDomains() {
  socket.emit("checkDomains", { domains: unchecked_domains.join(",") });
  $("#retry").css("display", "none");
}

function checkDomains() {
  // send unchecked domains to server to get more info
  let domains_to_check = [];
  for (const [domain, data] of Object.entries(domains)) {
    if ("part_of_fediverse" in data === false) {
      unchecked_domains.push(domain);
      domains_to_check.push({
        domain: domain,
        handle: data["handles"][0]["handle"],
      });
    }
  }
  if (domains_to_check.length > 0) {
    socket.emit("checkDomains", { domains: domains_to_check });
  }
}

function generateCSV() {
  let csv = "";
  csv = "Account address,Show boosts\n";

  for (const [domain, data] of Object.entries(domains)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      data["handles"].forEach(
        (handle) => (csv += handle.handle.replace("@", "") + ",true\n")
      );
    }
  }

  let download = new Blob([csv], { type: "text/plain" });
  let link = document.getElementById("downloadlink");
  link.href = window.URL.createObjectURL(download);
  link.download = "fedifinder_accounts.csv";
}

function displayAllAccounts() {
  $("#allAccounts").css("display", "block");
  $accountTable = $("<table>");
  $tableHead = $("<tr>");
  $tableHead.append("<th>username</th>");
  Object.keys(Object.values(accounts)[0]).forEach((key) =>
    $tableHead.append($("<th>").text(key))
  );
  $accountTable.append($tableHead);
  for (const [username, data] of Object.entries(accounts)) {
    $tr = $("<tr>");
    $tr.append($("<td>").text(username));
    for (const [key, value] of Object.entries(data)) {
      Array.isArray(value)
        ? $tr.append($("<td>").text(value.join("\n")))
        : value
        ? $tr.append($("<td>").text(value))
        : $tr.append($("<td>"));
    }
    $accountTable.append($tr);
  }
  $("#allAccounts").append($accountTable);
}

function generateAccountsCSV() {
  let output = [];
  for (const [username, data] of Object.entries(accounts)) {
    output.push({ username: username, ...data });
  }
  const json2csvParser = new json2csv.Parser();
  const csv = json2csvParser.parse(output);

  let download = new Blob([csv], { type: "text/plain" });
  let link = document.getElementById("csvAccountsDownload");
  link.href = window.URL.createObjectURL(download);
  link.download = "accounts.csv";
}

function generateAccountsJSON() {
  let json_string = JSON.stringify(accounts, null, 2);
  let download = new Blob([json_string], { type: "application/json" });
  let link = document.getElementById("jsonAccountsDownload");
  link.href = window.URL.createObjectURL(download);
  link.download = "accounts.json";
}

function checkListsLeft() {
  if ($("#lists option").length < 1) {
    $("#lists").remove();
    $("#listLoader").prop("disabled", true);
    $("#listSkipper").prop("disabled", true);
  }
}

function loadListMembers() {
  socket.emit("getList", $("#lists option:selected").val());
  $("#lists option:selected").remove();
  checkListsLeft();
}

function getFollowings() {
  socket.emit("getFollowings");
  $("#followingsLoader").prop("disabled", true);
}

function getFollowers() {
  socket.emit("getFollowers");
  $("#followersLoader").prop("disabled", true);
}

function loadLists() {
  socket.emit("loadLists", username);
  $("#listLoader").prop("disabled", true);
}

function skipList() {
  // remove the selected list from the menu
  $("#lists option:selected").remove();
  checkListsLeft();
}

function showBroken() {
  $("#brokenList").css("display", "block");
  $("#displayBroken").css("display", "none");
  display_brokenList = "block";
  displayBroken = "none";
}

function displayFollowButtons() {
  displayButtons ? (displayButtons = false) : (displayButtons = true);

  displayButtons
    ? $("#displayFollowButtons").text("hide follow buttons")
    : $("#displayFollowButtons").text("show follow buttons");

  displayAccounts();
}

function updateCounts() {
  // calculate scanned accounts and found handles

  let counter = 0;
  let broken_counter = 0;
  for (const [domain, data] of Object.entries(domains)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"])
      counter += data["handles"].length;
    if ("status" in data && "handles" in data && data["status"] != null) {
      broken_counter += data["handles"].length;
      $("#broken").css("display", "block");
    }
    if (unchecked_domains.length > 0) $("#retry").css("display", "inline");
  }

  counter > 0 ? $("#displayFollowButtons").css("visibility", "visible") : null;

  $("#nr_working").text(counter);
  $("#nr_checked").text(checked_accounts);
  $("#nr_broken").text(broken_counter);
  $("#domains_waiting").text(unchecked_domains.length);
}

function followButton(username, user_instance, target_url) {
  // https://domain.tld/authorize_interaction?uri=https%3A%2F%domain.tld%2F%40name
  return $("<a>")
    .addClass("followbutton")
    .attr("target", "_blank")
    .attr(
      "href",
      "https://" + user_instance + "/authorize_interaction?uri=" + target_url
    )
    .text("Follow @" + target_url.split("@")[1] + " from " + username);
}

function displayAccounts() {
  // replace the list of handles
  $list = $("<ul id='urlList'></ul>");
  for (const [domain, data] of Object.entries(domains)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      let openStatus = data.openRegistrations
        ? "<b>registration open</b>"
        : "registration closed";

      let local_domain = data.local_domain ? data.local_domain : domain;

      let domain_info =
        data.software_name +
        " " +
        data.software_version +
        ", " +
        (data.users_total
          ? data.users_total.toLocaleString() + " users, "
          : "") +
        (data.localPosts ? data.localPosts.toLocaleString() + " posts, " : "") +
        openStatus;
      $domain = $(
        "<li id='" +
          local_domain +
          "'><h3 style='margin-bottom:0'><a target='_blank' href='https://" +
          local_domain +
          "'>" +
          local_domain +
          "</a></h3><span>" +
          domain_info +
          "</span></li>"
      );
      $ol = $("<ol></ol>");

      data["handles"].forEach((handle) => {
        $li = $("<li>");
        let target_url =
          "https://" + local_domain + "/@" + handle.handle.split("@")[1];
        $li.append(
          $("<a>")
            .attr("href", target_url)
            .text(handle["handle"])
            .addClass("link")
        );

        $li.append(" (");

        $li.append(
          $("<a>")
            .attr("href", "https://twitter.com/" + handle.username)
            .text("@" + handle.username)
            .addClass("link")
        );

        $li.append(")<br>");

        if (displayButtons) {
          user_handles.map((user_handle) => {
            $li.append(
              followButton(user_handle, user_handle.split("@")[2], target_url)
            );
          });
        }

        $ol.append($li);
      });
      $domain.append($ol);

      $list.append($domain);
    }
  }
  $("#urlList").replaceWith($list);

  $list = $("<ul id='brokenList' style='font-size: .9em;'></ul>").css(
    "display",
    display_brokenList
  );
  for (const [domain, data] of Object.entries(domains)) {
    if ("status" in data && data["status"] != null) {
      //remove domains with client error: && (/4../.test(data["status"]) == false)
      $domain = $(
        "<li id='" +
          domain +
          "'><a target='_blank' href='https://" +
          domain +
          "'>" +
          domain +
          "</a><br><span>Maybe down, maybe not Fediverse. Error code: " +
          data["status"] +
          "</span></li>"
      );
      $ol = $("<ol></ol>");
      if ("handles" in data) {
        data["handles"].forEach((handle) => {
          let acc = handle.handle + " (@" + handle.username + ")";
          $ol.append($("<li>").text(acc).css("color", "darkred"));
        });
      }
      $domain.append($ol);

      $list.append($domain);
    }
  }
  $("#brokenList").replaceWith($list);
  $("#displayBroken").css("display", displayBroken);
}

socket.on("checkedDomains", function (data) {
  // add info about domains
  unchecked_domains = unchecked_domains.filter(
    (item) => item != data["domain"]
  );
  domains[data["domain"]] = Object.assign({}, domains[data["domain"]], data);
  updateCounts();
  displayAccounts();
  unchecked_domains.length < 1 ? $("#retry").css("display", "none") : void 0;
});

socket.on("userLists", function (lists) {
  // create menu to scan lists
  user_lists = lists;
  $("#listLoader").remove();
  $select = $(
    "<select id='lists' style='width:100%;margin-bottom:10px;'></select>"
  );
  lists.map((list) =>
    $select.append(
      '<option value="' +
        list["id_str"] +
        '">' +
        list["name"] +
        " (" +
        list["member_count"] +
        ")</option>"
    )
  );
  $form = $("#choices");
  $form.append($select);
  $form.append(
    '<input id="listLoader" type="button" onClick="loadListMembers();" value="Scan members">'
  );
  $form.append(
    '<input id="listSkipper" type="button" onClick="skipList()" value="Skip list">'
  );
  $("#choices").append($form);
});

socket.on("newAccounts", async function (data) {
  // receive new data from server
  if (data) {
    data.accounts.map((user) => processAccount(data.type, user));
    checkDomains();
    $("#infobox").css("visibility", "visible");
    $("#accountsInfo").css("visibility", "visible");
    $("#download").css("display", "block");
  }
});

socket.on("connect_error", (err) => handleErrors(err));
socket.on("connect_failed", (err) => handleErrors(err));
socket.on("disconnect", (err) => handleErrors(err));
socket.on("Error", (err) => handleErrors(err));

function handleErrors(data) {
  console.log("Server sent an error message:");
  console.log(data);
  if (typeof data === "string") {
    $("#error").text(
      "An unexpected error occured. \
Please reload the page.\n\n" + data
    );
    $("#error").css("background-color", "orange");
    $("#error").css("padding", "5px");
  } else if ("code" in data && data.code == 429) {
    // rate limit error
    // todo: differentiate between endpoints
    $("#error").text(
      "The Twitter API returned an error because of rate limiting. \
Please wait 15 minutes before trying again. You can still use the other options."
    );
    $("#error").css("background-color", "orange");
    $("#error").css("padding", "5px");

    let timer = new Date(0);
    timer.setUTCSeconds(data.rateLimit.reset);

    let countdown = setInterval(function () {
      let seconds = Math.floor((timer - new Date()) / 1000);
      $("#followingsLoader").prop("disabled", true);
      $("#followersLoader").prop("disabled", true);
      $("#followingsLoader").val("wait " + seconds + " seconds");
      $("#followersLoader").val("wait " + seconds + " seconds");
      if (seconds < 0) {
        clearInterval(countdown);
        $("#error").text("");
        $("#error").removeAttr("style");
        $("#followingsLoader").prop("disabled", false);
        $("#followingsLoader").val("Scan followings");
        $("#followersLoader").prop("disabled", false);
        $("#followersLoader").val("Scan followers");
      }
    }, 1000);
  } else if ("Error" in data && data.Error == "SessionError") {
    $("#error").text(
      "The Twitter API returned an error because of rate limiting. \
Please wait 15 minutes before trying again. You can still use the other options."
    );
    $("#error").css("background-color", "orange");
    $("#error").css("padding", "5px");
  } else {
    $("#error").text(
      "An unexpected error occured. \
Please reload the page.\n\n" + data
    );
    $("#error").css("background-color", "orange");
    $("#error").css("padding", "5px");
  }
}

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
  let words = text.split(/,|\s|“|\(|\)|'|》|\n|\r|\t|・|\||…|\.\s|\s$/);

  // remove common false positives
  let unwanted_domains =
    /gmail\.com|mixcloud|linktr\.ee|pinboardxing\com|researchgate|about|bit\.ly|imprint|impressum|patreon|donate|blog|facebook|news|github|instagram|t\.me|medium\.com|t\.co|tiktok\.com|youtube\.com|pronouns\.page|mail@|observablehq|twitter\.com|contact@|kontakt@|protonmail|medium\.com|traewelling\.de|press@|support@|info@|pobox|hey\.com/;
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
      /^.+\.[a-zA-Z]+.*\/(@|profile\/|\/u\/|\/c\/)[a-zA-Z0-9_]+\/*$/.test(word)
    )
      handles.push(handleFromUrl(word));

    // experimental. domain.tld/name. too many false positives
    // pleroma, snusocial
    //else if (/^.+\.[a-zA-Z]+\/[a-zA-Z_]+\/?$/.test(word)) console.log(word);
  });

  return handles;
}

function tweet_to_text(tweet) {
  // combine tweet text and expanded_urls
  let text = tweet["text"] + " ";

  if ("entities" in tweet && "urls" in tweet["entities"]) {
    tweet["entities"]["urls"].map(
      (url) => (text += ` ${url["expanded_url"]} `)
    );
  }
  return text;
}

function user_to_text(user) {
  // where handles could be: name, description, location, entities url urls expanded_url, entities description urls expanded_url
  let text = `${user["name"]} ${user["description"]} ${user["location"]}`;
  if ("entities" in user) {
    if ("url" in user["entities"] && "urls" in user["entities"]["url"]) {
      user["entities"]["url"]["urls"].map(
        (url) => (text += ` ${url["expanded_url"]} `)
      );
    }
    if (
      "description" in user["entities"] &&
      "urls" in user["entities"]["description"]
    ) {
      user["entities"]["description"]["urls"].map(
        (url) => (text += ` ${url["expanded_url"]} `)
      );
    }
  }
  return text;
}

async function processAccount(type, user) {
  let following, follower, list;

  // get list name from local user_lists
  type.type == "list"
    ? (list = user_lists.filter((list) => list.id_str == type.list_id)[0].name)
    : null;

  type.type == follower ? (follower = true) : null;
  type.type == following ? (following = true) : null;

  if (user.username in accounts) {
    accounts[user.username].following = accounts[user.username].following
      ? accounts[user.username].following
      : following;
    accounts[user.username].follower = accounts[user.username].follower
      ? accounts[user.username].follower
      : follower;
    type.type == "list"
      ? accounts[user.username].lists.push(list)
      : accounts[user.username].lists;
  } else {
    checked_accounts += 1;

    let text = `${user["name"]} ${user["description"]} ${user["location"]} ${
      user["pinned_tweet"]
    } ${user["urls"].join(" ")}`;

    let handles = findHandles(text);

    accounts[user.username] = {
      name: user.name,
      following: following,
      follower: follower,
      lists: [list],
      handles: handles,
      location: user.location,
      description: user.description,
      urls: user.urls,
      pinned_tweet: user.pinned_tweet,
    };
    addHandles(user.username, handles);
    removeDuplicates();
  }
  updateCounts();
}

if (/staging|localhost|127\.0\.0\.1/.test(location.hostname)) {
  // Happy testing

  tests({
    tinytest: () => {
      eq(2, 1 + 1);
    },
    "return handle based on URL string": () => {
      eq("@luca@vis.social", handleFromUrl("https://vis.social/@luca"));
      eq("@luca@vis.social", handleFromUrl("vis.social/@luca"));
      eq("@luca@vis.social", handleFromUrl("http://vis.social/@luca"));
    },
    "list of handles from a text stringt": () => {
      let text =
        "Twitter was my special interest. Scientific Programmer @sfb1472 fedi \
@luca@lucahammer.com \
http://vis.social/web/@Luca/ \
http://det.social/@luca \
@pv@botsin.space";
      let handles = findHandles(text);
      eq(true, handles.includes("@luca@lucahammer.com"));
      eq(true, handles.includes("@luca@vis.social"));
      eq(true, handles.includes("@luca@det.social"));
      eq(true, handles.includes("@pv@botsin.space"));
    },
  });
}
