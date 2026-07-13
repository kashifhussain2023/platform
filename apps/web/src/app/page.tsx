import { DarkNav } from '@/components/marketing-dark/DarkNav';
import { DarkHero } from '@/components/marketing-dark/DarkHero';
import { WhatIsVaep } from '@/components/marketing-dark/WhatIsVaep';
import { WorkflowBuilderSection } from '@/components/marketing-dark/WorkflowBuilderSection';
import { HowItWorks } from '@/components/marketing-dark/HowItWorks';
import { IntegrationsSection } from '@/components/marketing-dark/IntegrationsSection';
import { AiEmployeesGrid } from '@/components/marketing-dark/AiEmployeesGrid';
import { Testimonials } from '@/components/marketing-dark/Testimonials';
import { SecuritySection } from '@/components/marketing-dark/SecuritySection';
import { PricingSection } from '@/components/marketing-dark/PricingSection';
import { FinalCta } from '@/components/marketing-dark/FinalCta';
import { SiteFooter } from '@/components/marketing-dark/SiteFooter';

export default function HomePage() {
  return (
    <div className="font-marketing min-h-screen overflow-x-hidden bg-dark-hero">
      <DarkNav />
      <DarkHero />
      <WhatIsVaep />
      <WorkflowBuilderSection />
      <HowItWorks />
      <IntegrationsSection />
      <AiEmployeesGrid />
      <Testimonials />
      <SecuritySection />
      <PricingSection />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}
