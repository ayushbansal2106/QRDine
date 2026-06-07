# Design System & UI Specification: Smart QR Cafe Menu (QRDine)

This document details the design system, brand strategy, design tokens, components, and screen structures of the **Smart QR Cafe Menu (QRDine)** project, synchronized from the Stitch design model.

---

## 1. Creative North Star & Brand Strategy

### Creative North Star: "Serene Brew"
The **Smart QR Cafe Menu (QRDine)** experience is designed for a premium, modern cafe environment that prioritizes calm, clarity, and visual delight. The style blends **Minimalism** and **Tactile Modernism** to ensure digital interactions feel as pleasant as a physical cafe visit.

### Key Pillars
- **Visual Calmness**: Expansive whitespace, soft organic color palettes, and structured typography.
- **Tactile Depth**: Avoidance of harsh dividing lines; elevation is defined through background shifts and subtle ambient glows.
- **Frictionless Ritual**: Clear visual hierarchy ensuring ordering, tracking, and requesting assistance are immediate and satisfying.

---

## 2. Color Palette (Material Tokens)

The theme uses HSL/Hex color tokens to support clean transitions, high readability, and a relaxing light/dark hierarchy.

| Token | Hex Value | Application |
| :--- | :--- | :--- |
| **Primary** | `#51604f` | Sage Green - main brand highlights, primary buttons, and selected states. |
| **Primary Container** | `#6a7967` | Muted Sage - container backgrounds for primary actions. |
| **On Primary** | `#ffffff` | Text/icons on primary elements. |
| **Background** | `#fcf9f8` | Off-white canvas base to reduce eye strain. |
| **Surface** | `#fcf9f8` | Standard card/sheet background. |
| **Surface Container Lowest**| `#ffffff` | Pure white - elevated cards, inputs, and interactive widgets. |
| **Surface Container Low** | `#f6f3f2` | Inner sections, sidebar backgrounds, and secondary panels. |
| **Surface Container** | `#f0eded` | Divided block areas and default card states. |
| **Surface Container High** | `#eae7e7` | Elevated headers or active section backdrops. |
| **Surface Container Highest**| `#e4e2e1` | Deepest surface level. |
| **Secondary** | `#5e5e5b` | Muted slate/charcoal - secondary elements and auxiliary text. |
| **Secondary Container** | `#e1dfdb` | Soft cream/grey - background for secondary buttons. |
| **On Surface** | `#1b1c1c` | High-contrast charcoal for titles and main body copy. |
| **On Surface Variant** | `#444842` | Muted text for descriptions, subtitle copy, and placeholders. |
| **Error** | `#ba1a1a` | Alert red for error states and warnings. |

---

## 3. Typography Guide

Typography relies on **Inter** to ensure maximum legibility at all screen sizes. Visual hierarchy is achieved through dramatic size contrasts, letter-spacing adjustments, and weight shifts rather than using different typefaces.

```
Font Family: Inter
```

| Token | Size | Weight | Line Height | Letter Spacing | Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `headline-xl` | `40px` | `600` (SemiBold)| `48px` | `-0.02em` | Desktop Hero/Brand Headlines |
| `headline-xl-mobile`| `32px` | `600` (SemiBold)| `38px` | `-0.02em` | Mobile Hero/Banner Headers |
| `headline-lg` | `28px` | `600` (SemiBold)| `34px` | `-0.01em` | Section Headers / Table Numbers |
| `headline-md` | `22px` | `500` (Medium)  | `28px` | `Normal` | Card Titles / Dialog Titles |
| `body-lg` | `18px` | `400` (Regular) | `28px` | `Normal` | High-priority description text |
| `body-md` | `16px` | `400` (Regular) | `24px` | `Normal` | General body, reviews, items |
| `body-sm` | `14px` | `400` (Regular) | `20px` | `Normal` | Subtext, ingredient details, time |
| `label-md` | `14px` | `600` (SemiBold)| `16px` | `+0.02em` | Buttons, navigation tabs |
| `label-sm` | `12px` | `500` (Medium)  | `14px` | `+0.04em` | Dietary tags, badges (e.g. Vegan) |

---

## 4. Spacing, Shapes, & Elevation

### Spacing Scale
A fluid grid system driven by an **8px base unit**.
- `xs`: `4px`
- `base`: `8px`
- `sm`: `12px`
- `md`: `24px`
- `lg`: `48px`
- `xl`: `80px`
- `gutter`: `20px` (standard bento-grid gap)
- `margin-mobile`: `20px` (side padding for handheld devices)
- `margin-desktop`: `64px` (side padding for admin layout frames)

### Shape Roundness
To maintain a soft, welcoming, and tactile aesthetic, sharp edges are avoided:
- **Small Elements** (Badges, Chips): `sm` (`0.25rem` / `4px`) or `DEFAULT` (`0.5rem` / `8px`)
- **Interactive Controls** (Buttons, Text Inputs): `xl` (`0.75rem` / `12px`) or `full` (`9999px` pill-shape)
- **Large Content Blocks** (Cards, Bottom Sheets, Modals): `xl` (`0.75rem` / `12px`) or custom `16px` corner rounding.

### Elevation Levels
- **Level 0 (Flat)**: Background (`#fcf9f8`).
- **Level 1 (Soft Lift)**: Surface Container Lowest (`#ffffff`) + ambient shadow: `box-shadow: 0px 4px 20px rgba(0, 0, 0, 0.04)`.
- **Level 2 (Interactive/Sticky Panels)**: Floating headers, bottom sheets, navigation menus + deep soft shadow: `box-shadow: 0px 12px 32px rgba(0, 0, 0, 0.08)`.

---

## 5. Key UI Component Library

### 1. Buttons
* **Primary Button**: Filled Sage Green (`#51604f`) with white text. Pill-shaped (`rounded-full`) or heavily rounded (`rounded-xl`).
* **Secondary Button**: Outlined or soft cream background (`#e1dfdb`) with primary text color.
* **Stepper Buttons**: Small circular button (`w-10 h-10`) with an `add`/`remove` icon inside a light container.

### 2. Category Chips
* Horizontally scrollable row of rounded pills.
* Selected tab uses a solid Sage Green background; unselected uses a transparent/white background with an outline border.

### 3. Food/Menu Cards
* **Layout**: Image takes the top 60% with a zoom hover effect (`scale-105` transition). Details are placed below.
* **Badges**: Dietary tags (e.g., Vegan, Gluten-Free) float in the top-right corner over the image.
* **Shadow**: Uses Level 1 elevation to lift cards naturally.

### 4. Sticky Cart Summary
* **Mobile**: Docked to the bottom. Features item counts, total price, and a "View Cart" primary action.
* **Desktop**: Floats centered at the bottom of the screen with a `max-w-[600px]`, using Level 2 elevation for a sleek floating dock aesthetic.

---

## 6. Screen Inventory & Component Mapping

### Customer Mobile Interface

#### 1. Cafe Menu Page (`86c44609b4f74db4bd8bfb142054223b`)
* **Role**: Primary landing page for dining tables.
* **Layout**: Search bar at the top, category pills, asymmetric grid for items, and a sticky cart bar.
* **Elements**: Top App Bar ("Table 12"), Search input, Horizontal Category Chips, Bento Food Cards, Stepper, Floating Help/Chat button.

#### 2. Cart Page (`458c02aecf3f4f4ab5e6ba47e188e26b`)
* **Role**: Order checkout list.
* **Components**: Line items list, Quantity controllers, Special request text field, Totals checkout card, "Place Order" button.

#### 3. Order Confirmed (`8838667c9de14ba0b22e002de2413401`)
* **Role**: Confirmation landing page.
* **Components**: Success animation card, Order reference ID, Table summary, ETA timer display, "Track Order" button.

#### 4. Track Order Screen (`9261d3618c5842ce99fa35d021ce56b8`)
* **Role**: Real-time status update page.
* **Components**: Progress timeline, current status message, table assistance request shortcut.

#### 5. Request Assistance (`0b7bf7abadfd4179b56c158fcd71c63d`)
* **Role**: Modal for calling staff.
* **Components**: Preset quick-request chips ("Need Water", "Bring Bill", "Need Waiter"), Custom text area, "Send Request" button.

---

### Admin Desktop Interface

#### 1. Login Page (`d8b705a36d2b411e8f0ccafa28febdcb`)
* **Role**: Admin/staff access gate.
* **Components**: Centered card layout with Email/Password fields, brand icon, and single primary login button.

#### 2. Orders Dashboard (`646acbdc0e93428f9fd8f56bb97bbf8b`)
* **Role**: Staff view of active kitchen prep.
* **Components**: Sidebar navigation, Status Columns (Pending, Preparing, Ready, Served) containing summary order cards.

#### 3. Order Details (`b75ccaedfabd4b6aaf9f95a31665f2d2`)
* **Role**: Full inspection of a ticket.
* **Components**: Grid of ordered items, quantities, prep remarks, status update action dropdowns.

#### 4. Table Management (`3980fc750f064fc2b5587283d82bc578`)
* **Role**: Overview of physical floor layout.
* **Components**: Grid of restaurant tables indicating status (Occupied, Free, Assistance Required) with quick QR preview selectors.

#### 5. Menu Management (`74b57062f6f742b5b473a66902ef7bb0`)
* **Role**: Product list configurations.
* **Components**: Categories selector pane, data-table of products (name, category, price, availability toggle), "Add New Item" actions.

#### 6. QR Code Management (`cd077563a7fc4b0b9e07b0facfb49ea7`)
* **Role**: Dynamic table QR code generator interface.
* **Components**: QR card previews, print sizing parameters, bulk export actions.

#### 7. Assistance Requests Dashboard (`5e368a1b2b674bc19991e4d16e5bfc2e`)
* **Role**: Queue of active customer calls.
* **Components**: Queue list cards detailing request type, duration waiting, "Resolve/Clear" quick buttons.

#### 8. Settings Panel (`925258a575f64c488736b09b8bc3fa68`)
* **Role**: Cafe configuration panel.
* **Components**: Form inputs for Cafe Name, Logo Uploader, Address/Phone fields, Hours of Operation, and custom tax details.
