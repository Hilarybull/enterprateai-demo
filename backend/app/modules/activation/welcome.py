"""The shared signup and profile-claim welcome, in HTML and plain text."""
from html import escape

from app.modules.activation.rules import first_name

DASHBOARD = "https://www.enterprate.ai/dashboard"
WEBSITE = "https://www.enterprate.ai/"
INTRO = "You've just joined a smarter way to Plan, Operate, Sell and Grow your business powered by AI Agents and interconnected Business Intelligence."
BENEFITS = (
    ("DISCOVER BUSINESS OPPORTUNITIES", "Your dashboard brings you filtered public tenders and previously awarded contracts that match your business capabilities. Explore potential new contracts and subcontracting opportunities."),
    ("GET DISCOVERED & WIN CUSTOMERS", "Showcase your business on our marketplace, receive RFQs and respond to open RFPs."),
    ("PUT AI AGENTS TO WORK", "Get help preparing quotations, contracts, invoices and business plans. Manage your business workflows from one connected workspace."),
    ("MAKE SMARTER BUSINESS DECISIONS", "Our deterministic intelligence engines connect your business information, helping you explore how one decision could affect your finances, operations and growth."),
    ("SAVE ON SOFTWARE COSTS", "Enjoy free essential business tools, with advanced intelligence and automation available as you grow."),
)
DIFFERENCE = "Your business isn't a collection of isolated activities. Neither should your software be."
CONNECTED = "One connected workspace. AI-powered execution. Intelligence behind your decisions."
PASSWORD = "In case you did not set your password, use Password Reset."
CLOSING = "Don't just use AI to talk about your business. Put AI to work IN your business."


def render(name: str | None) -> tuple[str, str]:
    greeting = f"Hi {first_name(name)}," if first_name(name) else "Hi there,"
    text = "\n\n".join([
        greeting, "Welcome to EnterprateAI!", INTRO, "Here's what you can start doing today:",
        "\n".join(f"- {title} - {body}" for title, body in BENEFITS),
        "And here's what makes EnterprateAI different:", DIFFERENCE, CONNECTED, PASSWORD,
        f"Return to your EnterprateAI Dashboard — Click to Login: {DASHBOARD}", CLOSING,
        f"Welcome aboard\nPatrick\nCo-Founder, EnterprateAI\n{WEBSITE}",
    ])
    def paragraph(value: str, bold: bool = False) -> str:
        content = escape(value)
        return f"<p><strong>{content}</strong></p>" if bold else f"<p>{content}</p>"

    html = (
        "<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;max-width:640px;margin:auto'>"
        + paragraph(greeting) + paragraph("Welcome to EnterprateAI!", True) + paragraph(INTRO, True)
        + paragraph("Here's what you can start doing today:", True)
        + "<ul style='padding-left:22px'>"
        + "".join(f"<li style='margin-bottom:12px'><strong>{escape(title)}</strong> - {escape(body)}</li>" for title, body in BENEFITS)
        + "</ul>" + paragraph("And here's what makes EnterprateAI different:", True)
        + paragraph(DIFFERENCE) + paragraph(CONNECTED, True) + paragraph(PASSWORD, True)
        + "<p>👉 Return to your EnterprateAI Dashboard</p>"
        + f"<table role='presentation' cellspacing='0' cellpadding='0' style='margin:20px 0'><tr><td bgcolor='#4f46e5' style='border-radius:8px;text-align:center'><a href='{DASHBOARD}' style='display:inline-block;padding:14px 26px;border:1px solid #4f46e5;border-radius:8px;background:#4f46e5;color:#ffffff;font-weight:bold;text-decoration:none'>Click to Login</a></td></tr></table>"
        + paragraph(CLOSING, True)
        + f"<p style='margin-top:32px'>Welcome aboard<br><strong>Patrick</strong><br>Co-Founder, EnterprateAI<br><a href='{WEBSITE}'>www.enterprate.ai</a></p></div>"
    )
    return text, html
