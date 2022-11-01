const socket = io();
let csv = "";
let number_of_working_handles = 0;
let number_of_wrong_handles = 0;

socket.on("checkedDomains", function (data) {
  // add info about domains
  let css_id = "#" + data.domain.replaceAll(".", "\\.");
  if (data.well_known) {
    $(css_id).css("color", "forestgreen")
    number_of_working_handles += accounts[data.domain].length;
  } else {
    $(css_id).wrap("<del></del>");
    number_of_wrong_handles += accounts[data.domain].length;
    delete accounts[data.domain];
  }
  $('#nr_working').text(number_of_working_handles);
  $('#nr_not_working').text(number_of_wrong_handles);
});

$(function () {
  // once everything is loaded, sent the domains to the server for checking
  let domains = "";
  for (const [domain, handles] of Object.entries(accounts)) {
    domains += domain + ",";
  }
  domains = domains.slice(0, -1);
  socket.emit("checkDomains", { domains: domains });
});

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
