const socket = io();
let csv = "";
let number_of_working_handles = 0;
let number_of_wrong_handles = 0;
let lists = 0;

$(function () {
  // run after everything is loaded
  checkDomains();
  socket.emit("getLists", {
    username: username,
  });
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
  if (data.well_known) {
    $(css_id).css("color", "forestgreen");
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
  $form = $("<form></form>");
  $form.append($("<h3>Add handles from list members</h3>"));
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
  $form.append($select);
  $form.append(
    '<input type="button" onClick="loadListMembers();" value="Scan members">'
  );
  $("#choices").append($form);
});

socket.on("usersFromList", function (data) {
  for (const [domain, handles] of Object.entries(data.handles)) {
    if (domain in accounts) accounts[domain].push(...handles);
    else accounts[domain] = handles;
  }
  removeDuplicates();
  displayAccounts();
  checkDomains();
});

socket.on("Error", (data) => console.log(data));
