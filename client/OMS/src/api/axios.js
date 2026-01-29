import axios from "axios";

const instance = axios.create({
  baseURL: "https://order-management-system-ebld.onrender.com/",
});

// axios.js
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      console.warn("Unauthorized – redirecting");
      // DO NOT remove token here
      window.location.href = "/signin";
    }
    return Promise.reject(err);
  }
);


export default instance;
