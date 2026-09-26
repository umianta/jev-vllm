// Page snapshots in the shape the extension produces, for tests and the live eval.
import type { PageState } from "../src/types";

const ids = "abcdefghijklmnopqrstuvwxyz";
const page = (url: string, title: string, els: [string, string][]): PageState => ({
  url,
  title,
  elements: els.map(([role, text], i) => ({ id: ids[i], role, text })),
});

export const BLANK = page("chrome://newtab/", "New Tab", []);

export const YOUTUBE = page("https://www.youtube.com/", "YouTube", [
  ["link", "Home"],
  ["link", "Shorts"],
  ["link", "Subscriptions"],
  ["input", "Search"],
  ["button", "Search"],
  ["button", "Voice search"],
  ["link", "Lofi hip hop radio - beats to relax/study to"],
  ["link", "How transformers work, explained visually"],
  ["link", "Gordon Ramsay's perfect scrambled eggs"],
  ["link", "SpaceX Starship flight 12 full launch"],
  ["link", "Learn Rust in 30 minutes"],
  ["button", "Sign in"],
]);

export const WIKIPEDIA = page("https://en.wikipedia.org/wiki/Alan_Turing", "Alan Turing - Wikipedia", [
  ["link", "Main page"],
  ["input", "Search Wikipedia"],
  ["button", "Search"],
  ["link", "Talk"],
  ["link", "Edit"],
  ["link", "View history"],
  ["link", "Early life and education"],
  ["link", "Codebreaking at Bletchley Park"],
  ["link", "Turing machine"],
  ["link", "Enigma machine"],
  ["link", "Computing Machinery and Intelligence"],
  ["link", "Manchester Baby"],
]);

export const SHOP = page("https://shop.example.com/cart", "Your cart - Example Shop", [
  ["link", "Continue shopping"],
  ["input", "Promo code"],
  ["button", "Apply"],
  ["button", "Remove Wireless headphones"],
  ["select", "Quantity 1"],
  ["button", "Place order"],
  ["link", "Help"],
]);

export const LOGIN = page("https://github.com/login", "Sign in to GitHub", [
  ["input", "Username or email address"],
  ["input", "Password"],
  ["link", "Forgot password?"],
  ["button", "Sign in"],
  ["link", "Create an account"],
]);
