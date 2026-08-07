import nodemailer from 'npm:nodemailer@6.9.7';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'karunya.attendance@gmail.com',
    pass: 'udtl coml cmus kxjd',
  },
});

try {
  await transporter.verify();
  console.log("SMTP connection verified successfully");
} catch (error) {
  console.error("SMTP verification failed", error);
}
