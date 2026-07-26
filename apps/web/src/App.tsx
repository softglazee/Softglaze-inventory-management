import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Branding from "./components/Branding";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Units from "./pages/Units";
import Categories from "./pages/Categories";
import Products from "./pages/Products";
import Brands from "./pages/Brands";
import Purchases from "./pages/Purchases";
import Stock from "./pages/Stock";
import WeightCalc from "./pages/WeightCalc";
import POS from "./pages/POS";
import Display from "./pages/Display";
import WalkInReturn from "./pages/WalkInReturn";
import Sales from "./pages/Sales";
import Customers from "./pages/Customers";
import Vendors from "./pages/Vendors";
import PriceGroups from "./pages/PriceGroups";
import RateContracts from "./pages/RateContracts";
import Accounts from "./pages/Accounts";
import Payments from "./pages/Payments";
import Promises from "./pages/Promises";
import DayClose from "./pages/DayClose";
import Cheques from "./pages/Cheques";
import Bookings from "./pages/Bookings";
import Estimator from "./pages/Estimator";
import DeliveryTrips from "./pages/DeliveryTrips";
import Cutting from "./pages/Cutting";
import PurchaseOrders from "./pages/PurchaseOrders";
import VendorNotes from "./pages/VendorNotes";
import Labels from "./pages/Labels";
import Outreach from "./pages/Outreach";
import BankReconciliation from "./pages/BankReconciliation";
import Expenses from "./pages/Expenses";
import Employees from "./pages/Employees";
import Reports from "./pages/Reports";
import Users from "./pages/Users";
import SettingsPage from "./pages/Settings";
import Notifications from "./pages/Notifications";
import Messages from "./pages/Messages";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">Loading SoftGlaze…</div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
    <Branding />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/onboarding"
        element={
          <Protected>
            <Onboarding />
          </Protected>
        }
      />
      {/* POS + customer display are full-screen (outside the sidebar layout) */}
      <Route
        path="/pos"
        element={
          <Protected>
            <POS />
          </Protected>
        }
      />
      <Route
        path="/pos/display"
        element={
          <Protected>
            <Display />
          </Protected>
        }
      />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/walk-in-return" element={<WalkInReturn />} />
        <Route path="/products" element={<Products />} />
        <Route path="/brands" element={<Brands />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/units" element={<Units />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/weight-calc" element={<WeightCalc />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/price-groups" element={<PriceGroups />} />
        <Route path="/rate-contracts" element={<RateContracts />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/promises" element={<Promises />} />
        <Route path="/day-close" element={<DayClose />} />
        <Route path="/cheques" element={<Cheques />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/estimator" element={<Estimator />} />
        <Route path="/delivery-trips" element={<DeliveryTrips />} />
        <Route path="/cutting" element={<Cutting />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/vendor-notes" element={<VendorNotes />} />
        <Route path="/labels" element={<Labels />} />
        <Route path="/outreach" element={<Outreach />} />
        <Route path="/bank-reconciliation" element={<BankReconciliation />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<Users />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
