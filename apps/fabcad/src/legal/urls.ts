export const legalUrl = (page: "terms" | "privacy" | "licenses"): string => `${import.meta.env.BASE_URL}${page}.html`;
