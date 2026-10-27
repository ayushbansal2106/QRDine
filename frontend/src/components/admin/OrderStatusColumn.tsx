"use client";

import React from "react";
import { Order } from "@/types";
import { OrderTicket } from "./OrderTicket";

interface OrderStatusColumnProps {
  title: string;
  orders: Order[];
  onOrderUpdated?: () => void;
}

export const OrderStatusColumn: React.FC<OrderStatusColumnProps> = ({
  title,
  orders,
  onOrderUpdated,
}) => {
  return (
    <div className="flex-1 min-w-[280px] bg-surface-container-low rounded-xl p-sm flex flex-col gap-sm max-h-[80vh] overflow-y-auto font-inter">
      {/* Column Header */}
      <div className="flex justify-between items-center px-sm border-b border-surface-container pb-xs">
        <h3 className="font-semibold text-body-lg text-primary">{title}</h3>
        <span className="font-semibold text-label-sm bg-primary/10 text-primary px-sm py-xs rounded-full">
          {orders.length}
        </span>
      </div>

      {/* Tickets List */}
      <div className="flex flex-col gap-sm overflow-y-auto flex-1 pb-md">
        {orders.length > 0 ? (
          orders.map((order) => (
            <OrderTicket
              key={order.id}
              order={order}
              onStatusUpdated={onOrderUpdated}
            />
          ))
        ) : (
          <div className="text-center py-lg text-body-sm text-on-surface-variant/40 select-none">
            No orders
          </div>
        )}
      </div>
    </div>
  );
};
export default OrderStatusColumn;
