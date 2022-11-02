const socket = io();
let accounts = {};
let csv = "";
let number_of_working_handles = 0;
let number_of_wrong_handles = 0;
let lists = 0;

$(function () {
  // run after everything is loaded
});

function removeDuplicates() {
  for (const [domain, handles] of Object.entries(accounts)) {
    accounts[domain] = [...new Set(handles)];
  }
}

function checkDomains() {
  let domains = "";
  for (const [domain, handles] of Object.entries(accounts)) {
    domains += domain + ",";
  }
  domains = domains.slice(0, -1);
  socket.emit("checkDomains", { domains: domains });
  number_of_working_handles = 0;
  number_of_wrong_handles = 0;
}

function generateCSV() {
  csv = "Account address,Show boosts\n";

  for (const [domain, handles] of Object.entries(accounts)) {
    handles.forEach((handle) => (csv += handle + ",true\n"));
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

function displayAccounts() {
  $list = $("<ul id='urlList'></ul>");
  for (const [domain, handles] of Object.entries(accounts)) {
    $domain = $(
      "<li id='" +
        domain +
        "'><a href='https://" +
        domain +
        "'>" +
        domain +
        "</a></li>"
    );
    $ol = $("<ol></ol>");
    handles.forEach((handle) => $ol.append("<li>" + handle + "</li>"));
    $domain.append($ol);
    $list.append($domain);
  }
  $("#urlList").replaceWith($list);
}

socket.on("checkedDomains", function (data) {
  // add info about domains
  let css_id = "#" + data.domain.replaceAll(".", "\\.");
  let openStatus = data.openRegistrations
    ? "registration open"
    : "registration closed";
  if (data.part_of_fediverse) {
    $(css_id + " li").css("color", "forestgreen");
    $(
      "<br><span>" +
        data.software +
        ", " +
        data.users.toLocaleString() +
        " users, " +
        data.posts.toLocaleString() +
        " posts, " +
        openStatus +
        "</span>"
    ).insertAfter(css_id + " a");
    number_of_working_handles += accounts[data.domain].length;
  } else {
    $(css_id).wrap("<del></del>");
    number_of_wrong_handles += accounts[data.domain].length;
    delete accounts[data.domain];
  }
  $("#nr_working").text(number_of_working_handles);
  $("#nr_not_working").text(number_of_wrong_handles);
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
  for (const [domain, handles] of Object.entries(data)) {
    if (domain in accounts) accounts[domain].push(...handles);
    else accounts[domain] = handles;
  }
  removeDuplicates();
  displayAccounts();
  checkDomains();
  $("#download").css("display", "block");
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
