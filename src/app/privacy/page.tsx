import { Container, Shell } from "@/components/site/Shell";
export const metadata = { title: "Analytics and privacy" };
export default function PrivacyPage() {
  return <Shell><Container className="py-8"><div className="max-w-2xl space-y-4 text-fg-soft">
    <h1 className="font-display text-4xl text-fg">Analytics and privacy</h1>
    <p>Optional Google Ads measurement helps us understand whether ads lead visitors to retailers. Google Analytics can also measure shopping-tool use when configured. When enabled, it loads only after you choose Allow analytics. You can decline and still use the site.</p>
    <p>With your permission, Google receives basic page categories, controlled campaign labels, Google ad-click identifiers, filter-use and comparison actions, retailer-click events, and browser and device information. Analytics cookies identify visits and can link activity during their lifetime; our Analytics cookies are configured to expire after one day. Google Ads uses separate attribution cookies, whose lifetime is controlled by Google. We do not send chat messages, filter values, selected product lists, full retailer links, or URL queries other than the campaign labels and Google click identifiers described above through our analytics events.</p>
    <p>We keep advertising personalization and Google signals off. We do not use this setup to build remarketing audiences. A retailer click is not a purchase; retailers and affiliate networks operate their own sites and reporting.</p>
    <p>Your analytics choice is saved in your browser. Use Analytics preferences below the footer to change it. Withdrawing permission disables our collection and removes our Google Analytics and ad-attribution cookies; it does not erase information already collected. If that control is absent, optional analytics is not enabled on this deployment.</p>
    <p>Comparison selections are saved locally for the shopping experience. Hosting services process requests to deliver the site. This page describes our optional shopping analytics; other site features and external retailers have their own data handling.</p>
    <p>Questions: <a className="underline" href="mailto:wellnessfitcheck@gmail.com">wellnessfitcheck@gmail.com</a>. Read <a className="underline" href="https://policies.google.com/privacy">Google’s privacy policy</a> for Google’s processing.</p>
  </div></Container></Shell>;
}
