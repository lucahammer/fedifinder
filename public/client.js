const socket = io();
let csv = "";

socket.on("checkedDomains", function (data) {
  // add info about domains
  let css_id = "#" + data.domain.replaceAll(".", "\\.");
  if (data.well_known) {
    $(css_id).css("color", "green").css("font-weight", "bold");
  } else {
    $(css_id).wrap("<del></del>");
    delete accounts[data.domain];
  }
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
