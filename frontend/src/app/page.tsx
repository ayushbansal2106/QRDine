import Link from 'next/link';
import { getSubscriptionPlans } from "@/actions/subscription";

export default async function Home() {
  const plansResponse = await getSubscriptionPlans();
  const plans = plansResponse.success && Array.isArray(plansResponse.plans) 
    ? plansResponse.plans.filter((p: any) => p.isPaid) 
    : [];
  return (
    <div className="min-h-screen bg-[#fcf9f8] text-[#1b1c1c] font-sans selection:bg-[#51604f] selection:text-white">
      {/* Navigation */}
      <nav className="w-full flex justify-between items-center px-6 md:px-12 py-6 border-b border-[#f0eded]/50 backdrop-blur-md sticky top-0 z-50 bg-[#fcf9f8]/80">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#51604f] flex items-center justify-center">
            <span className="text-white font-semibold font-serif italic text-lg leading-none">Q</span>
          </div>
          <span className="font-semibold text-xl tracking-tight text-[#1b1c1c]">QRDine</span>
        </div>
        <div className="flex gap-4 items-center">
          <Link
            href="/cafe/login"
            className="text-sm font-semibold text-[#444842] hover:text-[#1b1c1c] transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/cafe/signup"
            className="text-sm font-semibold bg-[#51604f] text-white px-5 py-2.5 rounded-full hover:bg-[#6a7967] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col items-center text-center relative overflow-hidden">
        {/* Background decorative blobs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] max-w-4xl opacity-40 pointer-events-none">
          <div className="absolute top-10 left-0 w-72 h-72 bg-[#51604f]/10 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
          <div className="absolute top-0 right-0 w-72 h-72 bg-[#6a7967]/10 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-72 h-72 bg-[#e1dfdb]/30 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f6f3f2] border border-[#e4e2e1] mb-8">
            <span className="w-2 h-2 rounded-full bg-[#51604f] animate-pulse"></span>
            <span className="text-xs font-semibold text-[#444842] uppercase tracking-wider">The Future of Dining</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-[#1b1c1c] max-w-4xl leading-[1.1]">
            A <span className="text-[#51604f] italic font-serif">calm</span> and frictionless ordering experience.
          </h1>
          
          <p className="mt-8 text-xl text-[#444842] max-w-2xl mx-auto font-normal leading-relaxed">
            Elevate your cafe with Smart QR menus. Guests order seamlessly from their phones while your team focuses on hospitality, not taking tickets.
          </p>
          
          <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/cafe/signup"
              className="w-full sm:w-auto text-base font-semibold bg-[#51604f] text-white px-8 py-4 rounded-full hover:bg-[#6a7967] hover:shadow-xl hover:shadow-[#51604f]/20 hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              Start your free trial
              <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </Link>
            <Link
              href="#pricing"
              className="w-full sm:w-auto text-base font-semibold bg-white text-[#1b1c1c] border border-[#e4e2e1] px-8 py-4 rounded-full hover:bg-[#f6f3f2] transition-colors flex items-center justify-center"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section className="bg-white py-24 border-y border-[#f0eded]">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-[#1b1c1c]">Tactile Modernism for your Guests</h2>
            <p className="mt-4 text-[#444842] max-w-2xl mx-auto">Designed to mimic the physical delight of a premium cafe menu, digitised for speed and accuracy.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-[24px] bg-[#fcf9f8] border border-[#f0eded] hover:shadow-2xl hover:shadow-black/5 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-6 text-[#51604f] border border-[#e4e2e1]">
                <span className="material-symbols-outlined">qr_code_scanner</span>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-[#1b1c1c]">Instant QR Ordering</h3>
              <p className="text-[#444842] leading-relaxed">No apps to download. Guests scan the table code and instantly browse a stunning, fast menu.</p>
            </div>
            
            {/* Feature 2 */}
            <div className="p-8 rounded-[24px] bg-[#fcf9f8] border border-[#f0eded] hover:shadow-2xl hover:shadow-black/5 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-6 text-[#51604f] border border-[#e4e2e1]">
                <span className="material-symbols-outlined">sync_alt</span>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-[#1b1c1c]">Live Kitchen Sync</h3>
              <p className="text-[#444842] leading-relaxed">Orders flow directly to the admin dashboard. Mark items preparing, ready, or served in real time.</p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-[24px] bg-[#fcf9f8] border border-[#f0eded] hover:shadow-2xl hover:shadow-black/5 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-6 text-[#51604f] border border-[#e4e2e1]">
                <span className="material-symbols-outlined">concierge</span>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-[#1b1c1c]">Waiter Assistance</h3>
              <p className="text-[#444842] leading-relaxed">Guests can quietly ping staff for water, the bill, or general help right from their phones.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-[#fcf9f8]">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-[#1b1c1c]">Simple, Transparent Pricing</h2>
            <p className="mt-4 text-[#444842] max-w-2xl mx-auto">Start with a 14-day free trial. No credit card required.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 max-w-6xl mx-auto gap-8">
            {plans.length > 0 ? (
              plans.map((plan: any) => {
                const isRecommended = plan.key === "growth";
                
                return (
                  <div key={plan.key} className={`p-8 rounded-[32px] flex flex-col relative ${isRecommended ? "bg-[#51604f] text-white shadow-[0_20px_40px_rgba(81,96,79,0.2)] overflow-hidden" : "bg-white border border-[#e4e2e1] shadow-[0_12px_32px_rgba(0,0,0,0.04)]"}`}>
                    {isRecommended && (
                      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    )}
                    
                    <div className="mb-8 relative z-10">
                      {isRecommended && (
                        <div className="inline-block px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-sm font-medium mb-4">Recommended</div>
                      )}
                      <h3 className={`text-2xl font-bold ${!isRecommended ? "text-[#1b1c1c]" : ""}`}>{plan.name} Plan</h3>
                      <p className={`mt-2 ${isRecommended ? "text-white/80" : "text-[#444842]"}`}>{plan.blurb}</p>
                    </div>
                    
                    <div className="mb-8 flex items-baseline gap-1 relative z-10">
                      <span className={`text-5xl font-bold ${!isRecommended ? "text-[#1b1c1c]" : ""}`}>₹{plan.monthly.rupees}</span>
                      <span className={`font-medium ${isRecommended ? "text-white/80" : "text-[#444842]"}`}>/ month</span>
                    </div>
                    
                    <ul className="space-y-4 mb-10 flex-1 relative z-10">
                      {plan.features.map((feature: string, i: number) => (
                        <li key={i} className={`flex items-center gap-3 ${isRecommended ? "text-white/90" : "text-[#444842]"}`}>
                          <span className={`material-symbols-outlined text-xl ${isRecommended ? "text-white" : "text-[#51604f]"}`}>check_circle</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                    
                    <Link
                      href="/cafe/signup"
                      className={`w-full py-4 rounded-xl font-semibold text-center transition-colors relative z-10 ${isRecommended ? "bg-white text-[#51604f] hover:bg-[#f6f3f2] shadow-lg" : "border-2 border-[#51604f] text-[#51604f] hover:bg-[#51604f] hover:text-white"}`}
                    >
                      {isRecommended ? "Get Started" : "Start Trial"}
                    </Link>
                  </div>
                );
              })
            ) : (
              <div className="col-span-full text-center text-[#444842]">
                Loading plans...
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-[#f0eded] py-12">
        <div className="max-w-7xl mx-auto px-6 md:px-12 text-center text-[#444842]">
          <div className="w-10 h-10 rounded-full bg-[#51604f] flex items-center justify-center mx-auto mb-6">
            <span className="text-white font-semibold font-serif italic text-xl leading-none">Q</span>
          </div>
          <p>© {new Date().getFullYear()} QRDine. Designed for modern hospitality.</p>
        </div>
      </footer>
    </div>
  );
}
