import { services } from "@/lib/services";
import { ServiceCard } from "@/components/ServiceCard";
import MBConnectivityPanel from "@/components/MBConnectivityPanel";

export default function DashboardPage() {
 return (
 <main className="container mx-auto p-8 max-w-screen-2xl">
 <div className="flex items-center justify-between mb-8">
 <div>
 <h1 className="text-3xl font-bold tracking-tight">Melodarr Proxy</h1>
 <p className="text-secondary mt-2">Service status, observability, and runtime controls.</p>
 </div>
 </div>

 <div className="mb-6">
 <MBConnectivityPanel />
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
 {services.map((service) => (
 <ServiceCard key={service.name} service={service} />
 ))}
 </div>
 </main>
 );
}
