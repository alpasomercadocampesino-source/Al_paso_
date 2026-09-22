import nodemailer from "nodemailer";
import { Order } from "./db.js";

export async function sendOrderSummaryEmail(
  idPedido: string,
  sucursal: string,
  fecha: string,
  orders: Order[]
) {
  const recipient = "alpasomercadocampesino@gmail.com";
  const smtpUser = process.env.SMTP_USER || "alpasomercadocampesino@gmail.com";
  const smtpPass = process.env.SMTP_PASSWORD;

  console.log(`[Email] Preparando resumen de pedido para ${recipient}...`);

  // Build HTML Content
  const orderRows = orders
    .map(
      (o, idx) => `
    <tr style="background-color: ${idx % 2 === 0 ? "#f9f9f9" : "#ffffff"};">
      <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: #333;">${o.Codigo}</td>
      <td style="padding: 10px; border: 1px solid #ddd; color: #333;">${o.Producto}</td>
      <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold; color: #2e7d32;">${o.Cantidad}</td>
      <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color: #555;">${o.Medida}</td>
      <td style="padding: 10px; border: 1px solid #ddd; text-align: right; color: #555;">${o.Kilos.toFixed(1)} kg</td>
      <td style="padding: 10px; border: 1px solid #ddd; color: #666; font-style: italic;">${o.Notas || "-"}</td>
      <td style="padding: 10px; border: 1px solid #ddd; color: #333;">${o.Proveedor || "-"}</td>
    </tr>
  `
    )
    .join("");

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
      <div style="background-color: #1b5e20; color: #ffffff; padding: 15px; border-radius: 6px 6px 0 0; text-align: center; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">Al Paso - Mercado Campesino</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">¡Nuevo Pedido Registrado!</p>
      </div>
      
      <div style="margin-bottom: 25px; padding: 15px; background-color: #f1f8e9; border-left: 4px solid #4caf50; border-radius: 0 4px 4px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 4px 0; color: #555; font-weight: bold; width: 30%;">ID de Pedido:</td>
            <td style="padding: 4px 0; color: #333; font-weight: bold;">${idPedido}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555; font-weight: bold;">Sucursal / Punto:</td>
            <td style="padding: 4px 0; color: #1b5e20; font-weight: bold; text-transform: uppercase;">${sucursal}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555; font-weight: bold;">Fecha del Pedido:</td>
            <td style="padding: 4px 0; color: #333;">${fecha}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #555; font-weight: bold;">Ítems Solicitados:</td>
            <td style="padding: 4px 0; color: #333; font-weight: bold;">${orders.length} productos</td>
          </tr>
        </table>
      </div>

      <h3 style="color: #2e7d32; border-bottom: 2px solid #a5d6a7; padding-bottom: 6px; margin-bottom: 12px; font-size: 16px;">Detalle de los Productos</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 25px;">
        <thead>
          <tr style="background-color: #e8f5e9; text-align: left;">
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold;">Código</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold;">Producto</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold; text-align: center;">Cant.</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold; text-align: center;">Medida</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold; text-align: right;">Est. Kilos</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold;">Notas</th>
            <th style="padding: 10px; border: 1px solid #ddd; color: #1b5e20; font-weight: bold;">Proveedor</th>
          </tr>
        </thead>
        <tbody>
          ${orderRows}
        </tbody>
      </table>

      <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; margin-top: 25px; text-align: center; color: #888; font-size: 11px;">
        <p style="margin: 0;">Este es un reporte automático generado por el sistema de Al Paso - Mercado Campesino.</p>
        <p style="margin: 4px 0 0 0;">Copia de seguridad en tiempo real para: <strong>${recipient}</strong></p>
      </div>
    </div>
  `;

  if (!smtpPass) {
    console.warn(
      `[Email warning] No se especificó SMTP_PASSWORD en las variables de entorno.` +
      ` El resumen del pedido ${idPedido} se registró en base de datos local y Firebase Firestore,` +
      ` pero no se puede enviar por email hasta que configures SMTP_PASSWORD.`
    );
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailOptions = {
      from: `"Al Paso Sistema" <${smtpUser}>`,
      to: recipient,
      subject: `[Al Paso] Nuevo Pedido de ${sucursal.toUpperCase()} - ${idPedido}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email success] Correo enviado exitosamente para el pedido ${idPedido}:`, info.messageId);
    return true;
  } catch (error) {
    console.error(`[Email error] Error al enviar el correo para el pedido ${idPedido}:`, error);
    return false;
  }
}
