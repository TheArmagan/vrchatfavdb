const LS_AUTH = "VRCFAVDB;Cookies;Auth";
const LS_TWO_FACTOR_AUTH = "VRCFAVDB;Cookies;TwoFactorAuth";
const LS_APP_COOKIE = "VRCFAVDB;App;Cookie";

const app = window.app = Vue.createApp({
  data() {
    return {
      username: "",
      password: "",
      otpCode: "",
      otpTypes: ["emailOtp"],
      otpType: "emailOtp",
      otpMessage: "",
      currentStep: 1,
      loadingStep1: false,
      loadingStep2: false,
      otpTypeMap: {
        emailOtp: "Email",
        totp: "Authenticator App",
        otp: "OTP"
      },
      cookie: {
        auth: "",
        twoFactorAuth: ""
      }
    };
  },
  mounted() {
    window.internalApp = this;
  },
  methods: {
    async loginStep1() {
      let username = this.username.trim();
      let password = this.password.trim();
      if (!username || !password) return Toast.show("Please fill all fields.");

      this.loadingStep1 = true;

      const res = await fetch("/api/vrc/auth/step1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
      });

      this.loadingStep1 = false;

      let json = await res.json();
      if (!res.ok) return Toast.show(`Failed to login: ${json.error}`);

      localStorage.setItem(LS_AUTH, json.data.auth.value);
      localStorage.setItem(LS_APP_COOKIE, `auth=${json.data.auth.value}`);
      this.cookie.auth = json.data.auth.value;
      if (!json.data.nextStep?.length) {
        return location.href = `/app?__toasts=${JSON.stringify(["Logged in successfully!"])}`;
      }

      this.currentStep = 2;
      this.otpTypes = json.data.nextStep;
      if (json.data.nextStep.includes("emailOtp")) {
        this.otpType = "emailOtp";
        this.otpMessage = "Please check your email for the verification code.";
      } else {
        this.otpType = "totp";
        this.otpMessage = "Please enter the verification code from your authenticator app.";
      }
      Toast.show(this.otpMessage);
    },
    async loginStep2() {
      let otpCode = `${this.otpCode || ""}`.trim();
      if (!otpCode) return Toast.show("Please enter the verification code.");

      this.loadingStep2 = true;

      const res = await fetch("/api/vrc/auth/step2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          authCookie: this.cookie.auth,
          code: otpCode,
          type: this.otpType
        })
      });

      this.loadingStep2 = false;

      let json = await res.json();
      if (!res.ok) return Toast.show(`Failed to verify: ${json.error}`);

      localStorage.setItem(LS_TWO_FACTOR_AUTH, json.data.twoFactorAuth.value);
      localStorage.setItem(LS_APP_COOKIE, `auth=${this.cookie.auth};twoFactorAuth=${json.data.twoFactorAuth.value}`);
      this.cookie.twoFactorAuth = json.data.twoFactorAuth.value;

      location.href = `/app?__toasts=${JSON.stringify(["Logged in successfully!"])}`;
    }
  }
});


app.mount("#app");