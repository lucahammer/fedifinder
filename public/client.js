const socket = io();
let accounts = {};
let csv = "";
let lists = 0;
let checked_accounts = 0;

$(function () {
  // run after everything is loaded
});

function removeDuplicates() {
  for (const [domain, data] of Object.entries(accounts)) {
    accounts[domain]["handles"] = [...new Set(data["handles"])];
  }
}

function checkDomains() {
  let domains = "";
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data === false) {
      domains += domain + ",";
    }
  }
  domains = domains.slice(0, -1);
  if (domains.length > 0) {
    socket.emit("checkDomains", { domains: domains });
  }
}

function generateCSV() {
  csv = "Account address,Show boosts\n";

  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      data["handles"].forEach((handle) => (csv += handle + ",true\n"));
    }
  }

  let download = new Blob([csv], { type: "text/plain" });
  let link = document.getElementById("downloadlink");
  link.href = window.URL.createObjectURL(download);
  link.download = "fedifinder_following_accounts.csv";
}

function loadListMembers() {
  socket.emit("scanList", $("#lists option:selected").val());
  $("#lists option:selected").remove();
}

function scanFollowings() {
  socket.emit("scanFollowings");
  $("#followingsLoader").prop("disabled", true);
}

function loadLists() {
  socket.emit("loadLists", username);
  $("#listLoader").prop("disabled", true);
}

function updateCounts() {
  let counter = 0;
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"])
      counter += data["handles"].length;
  }
  $("#nr_working").text(counter);
  $("#nr_checked").text(checked_accounts);
}

function displayAccounts() {
  $list = $("<ul id='urlList'></ul>");
  for (const [domain, data] of Object.entries(accounts)) {
    if ("part_of_fediverse" in data && data["part_of_fediverse"]) {
      let openStatus = data.openRegistrations
        ? "<b>registration open</b>"
        : "registration closed";

      $domain = $(
        "<li id='" +
          domain +
          "'><a target='_blank' href='https://" +
          domain +
          "'>" +
          domain +
          "</a><br><span>" +
          data.software +
          ", " +
          data.users.toLocaleString() +
          " users, " +
          data.posts.toLocaleString() +
          " posts, " +
          openStatus +
          "</span></li>"
      );
      $ol = $("<ol></ol>");
      data["handles"].forEach((handle) =>
        $ol.append("<li style='color:forestgreen'>" + handle + "</li>")
      );
      $domain.append($ol);

      $list.append($domain);
    }
  }
  $("#urlList").replaceWith($list);
}

socket.on("checkedDomains", function (data) {
  // add info about domains
  accounts[data["domain"]] = Object.assign({}, accounts[data["domain"]], data);
  updateCounts();
  displayAccounts();
});

socket.on("userLists", function (lists) {
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
    '<input type="button" onClick="loadListMembers();" value="Scan members">'
  );
  $form.append('<input type="button" onClick="skipList()" value="Skip list">');
  $("#choices").append($form);
});

function skipList() {
  $("#lists option:selected").remove();
}

socket.on("newHandles", function (data) {
  checked_accounts += data["amount"];
  for (const [domain, handles] of Object.entries(data["handles"])) {
    if (domain in accounts) accounts[domain]["handles"].push(...handles);
    else accounts[domain] = { handles: handles };
  }

  if (Object.keys(accounts).length > 0) {
    removeDuplicates();
    checkDomains();
    $("#download").css("display", "block");
  }
});

socket.on("Error", (data) => {
  console.log("Server sent an error message:");
  console.log(data);
  if ("code" in data && data.code == 88) {
    $("#error").text(
      "The Twitter API returned an error because of rate limiting. \
Please wait 15 minutes before trying again. You can still use the other options."
    );
    $("#error").css("background-color", "orange");
    $("#error").css("padding", "5px");

    let timer = new Date(new Date().getTime() + 15 * 60000);

    let countdown = setInterval(function () {
      let seconds = Math.floor((timer - new Date()) / 1000);
      $("#followingsLoader").val("wait " + seconds + " seconds");
      if (seconds < 0) {
        clearInterval(countdown);
        $("#error").text("");
        $("#error").removeAttr("style");
        $("#followingsLoader").prop("disabled", false);
        $("#followingsLoader").val("Scan followings");
      }
    }, 1000);
  }
});
