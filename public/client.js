/* globals io, username, tests, eq */

const socket = io();
let accounts = {};
let checked_accounts = 0;
let user_lists = [];
let unchecked_domains = [];
let display_brokenList = "none";
let displayBroken = "inline";

function removeDuplicates() {
  for (const [domain, data] of Object.entries(accounts)) {
    if ("handles" in accounts[domain]) {
      accounts[domain]["handles"] = [
        ...new Map(
          accounts[domain]["handles"].map((v) => [v.handle, v])
        ).values(),
      ];
    }
  }
  accounts.sort((a, b) => a.price - b.price);
}

function addHandles(data) {
  // add recieved handles to accounts list

  data.forEach((account) => {
    if (account["handles"].length > 0) {
      account["handles"].forEach((handle) => {
        let domain = handle.split("@").slice(-1)[0];
        if (domain in accounts) {
          accounts[domain]["handles"].push({
            username: account.username,
            handle: handle,
          });
        } else
          accounts[domain] = {
            handles: [{ username: account.username, handle: handle }],
          };
      });
    }
  });
}

function retryDomains() {
  socket.emit("checkDomains", { domains: unchecked_domains.join(",") });
  $("#retry").css("display", "none");
}

function checkDomains() {
  // send unchecked domains to server to get more info
  let domains = "";
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data === false) {
      unchecked_domains.push(domain);
      domains += domain + ",";
    }
  }
  domains = domains.slice(0, -1);
  if (domains.length > 0) {
    socket.emit("checkDomains", { domains: domains });
  }
}

function generateCSV() {
  let csv = "";
  csv = "Account address,Show boosts\n";

  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      data["handles"].forEach((handle) => (csv += handle.handle + ",true\n"));
    }
  }

  let download = new Blob([csv], { type: "text/plain" });
  let link = document.getElementById("downloadlink");
  link.href = window.URL.createObjectURL(download);
  link.download = "fedifinder_following_accounts.csv";
}

function checkListsLeft() {
  if ($("#lists option").length < 1) {
    $("#lists").remove();
    $("#listLoader").prop("disabled", true);
    $("#listSkipper").prop("disabled", true);
  }
}

function loadListMembers() {
  socket.emit("scanList", $("#lists option:selected").val());
  $("#lists option:selected").remove();
  checkListsLeft();
}

function scanFollowings() {
  socket.emit("scanFollowings");
  $("#followingsLoader").prop("disabled", true);
}

function scanFollowers() {
  socket.emit("scanFollowers");
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

function updateCounts() {
  // calculate scanned accounts and found handles

  let counter = 0;
  let broken_counter = 0;
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"])
      counter += data["handles"].length;
    if ("status" in data && "handles" in data && data["status"] != null) {
      broken_counter += data["handles"].length;
      $("#broken").css("display", "block");
    }
    if (unchecked_domains.length > 0) $("#retry").css("display", "inline");
  }

  $("#nr_working").text(counter);
  $("#nr_checked").text(checked_accounts);
  $("#nr_broken").text(broken_counter);
  $("#domains_waiting").text(unchecked_domains.length);
}

function displayAccounts() {
  // replace the list of handles
  $list = $("<ul id='urlList'></ul>");
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      let openStatus = data.openRegistrations
        ? "<b>registration open</b>"
        : "registration closed";

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
          domain +
          "'><a target='_blank' href='https://" +
          domain +
          "'>" +
          domain +
          "</a><br><span>" +
          domain_info +
          "</span></li>"
      );
      $ol = $("<ol></ol>");
      data["handles"].forEach((handle) => {
        $acc = $("<a>")
          .attr(
            "href",
            "https://" + domain + "/@" + handle.handle.split("@")[1]
          )
          .text(handle["handle"])
          .addClass("link");

        $twit = $("<a>")
          .attr("href", "https://twitter.com/" + handle.username)
          .text("(@" + handle.username + ")")
          .addClass("link");
        $ol.append(
          $("<li>")
            .append($acc)
            .css("color", "forestgreen")
            .append(" ")
            .append($twit)
        );
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
  for (const [domain, data] of Object.entries(accounts)) {
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
  accounts[data["domain"]] = Object.assign({}, accounts[data["domain"]], data);
  updateCounts();
  displayAccounts();
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

socket.on("newHandles", function (data) {
  // receive new handles

  checked_accounts += data.length;
  updateCounts();

  addHandles(data);

  if (Object.keys(accounts).length > 0) {
    removeDuplicates();
    checkDomains();
    $("#infobox").css("visibility", "visible");
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

  // different separators people use
  text = text
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}^$\n@\.]/gu, " ")
    .toLowerCase()
    .normalize("NFKD");

  let words = text.split(/,| |\s|“|\(|\)|'|》|\n|\r|\t|・|\||…|▲|\.\s|\s$/);
  // remove common false positives
  let unwanted_domains =
    /gmail\.com|mixcloud|linktr\.ee|researchgate|about|bit\.ly|imprint|impressum|patreon|donate|blog|facebook|news|github|instagram|t\.me|medium\.com|t\.co|tiktok\.com|youtube\.com|pronouns\.page|mail@|observablehq|twitter\.com|contact@|kontakt@|protonmail|medium\.com|traewelling\.de|press@|support@|info@|pobox|hey\.com/;
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

async function processAccounts(data) {
  // scan accounts for handles
  let accounts = [];
  let batch_size = 500;

  try {
    for await (const user of data) {
      const pinnedTweet = data.includes.pinnedTweet(user);
      let text = user_to_text(user);
      pinnedTweet ? (text += " " + tweet_to_text(pinnedTweet)) : "";
      let handles = findHandles(text);
      accounts.push({
        username: user.username,
        handles: handles,
      });

      if (accounts.length >= batch_size) {
        // don't wait until all accounts are loaded
        socket.emit("newHandles", accounts);
        accounts = [];
      }
    }
    accounts.length > 0 ? socket.emit("newHandles", accounts) : void 0;
  } catch (err) {
    socket.emit("Error", err);
    accounts.length > 0 ? socket.emit("newHandles", accounts) : void 0;
  }
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
