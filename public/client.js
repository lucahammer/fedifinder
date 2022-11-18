/* globals io, tests, eq json2csv, Vue*/
var socket = io();

const app = Vue.createApp({
  data() {
    return {
      scan_count: 0,
      unqiue_count: 0,
      followed_count: 0,
      broken_count: 0,
      unchecked_domains_count: 0,
    };
  },
  computed: {
    instance: function () {
      if (this.inputUrl.includes("http")) {
        let location = new URL(this.inputUrl);
        return location.hostname;
      } else if (this.inputUrl != "") {
        return this.inputUrl;
      } else {
        this.inputUrl = this.placeholder;
        return this.placeholder;
      }
    },
  },
  methods: {
    showTimeline: function () {
      this.loaded = false;
      if (this.inputUrl == "") this.inputUrl = this.placeholder;
      this.toots = [];
      this.updateLocation();
      this.nextUrl =
        "https://" +
        this.instance +
        "/api/v1/timelines/public?local=" +
        this.local +
        "&limit=40";
      this.loadToots();
    },
  },
  mounted() {},
});
app.mount("#fedifinder");
