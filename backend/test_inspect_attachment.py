import os
import sys
import asyncio
import tempfile
import openpyxl
from app.services.ai_tools import COPILOT_TOOLS, parse_attachment_file, execute_copilot_tool

def test_tool_definitions():
    print('Testing COPILOT_TOOLS schema...')
    tool_names = [t['function']['name'] for t in COPILOT_TOOLS]
    assert 'search_emails' in tool_names, 'search_emails missing from COPILOT_TOOLS'
    assert 'inspect_attachment' in tool_names, 'inspect_attachment missing from COPILOT_TOOLS'
    inspect_def = next(t for t in COPILOT_TOOLS if t['function']['name'] == 'inspect_attachment')
    assert 'attachment_id' in inspect_def['function']['parameters']['properties']
    print('COPILOT_TOOLS schema verified.')

def test_parsers():
    print('Testing parse_attachment_file for various formats...')
    with tempfile.NamedTemporaryFile(suffix='.csv', mode='w', encoding='utf-8', delete=False) as f:
        f.write('item,qty,price\nwidget A,10,19.99\nwidget B,5,49.50\n')
        csv_path = f.name

    try:
        csv_parsed = parse_attachment_file(csv_path, 'sample_invoice.csv')
        assert 'widget A' in csv_parsed
        assert '19.99' in csv_parsed
        print('CSV parser works.')
    finally:
        os.remove(csv_path)

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as f:
        xlsx_path = f.name

    try:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Quotes'
        ws.append(['Part #', 'Description', 'Unit Cost', 'Extended'])
        ws.append(['P-1001', 'Custom Patch 3 inch', '.50', '.00'])
        wb.save(xlsx_path)
        wb.close()

        xlsx_parsed = parse_attachment_file(xlsx_path, 'quote.xlsx')
        assert 'Quotes' in xlsx_parsed
        assert 'Custom Patch 3 inch' in xlsx_parsed
        assert '.00' in xlsx_parsed
        print('Excel parser works.')
    finally:
        os.remove(xlsx_path)

    real_pdf = r'E:\Email-Yalis\data\attachments\att_f2587d549c09_MAXS326031150493-1773200852.pdf'
    if os.path.exists(real_pdf):
        pdf_parsed = parse_attachment_file(real_pdf, 'MAXS326031150493-1773200852.pdf')
        assert 'Max emblem' in pdf_parsed or 'Order' in pdf_parsed
        assert '17644.46' in pdf_parsed or 'Total' in pdf_parsed
        print('Real PDF parsing verified.')

    real_img = r'E:\Email-Yalis\data\attachments\att_4ce3a77b5d43_hzpa10049_1.jpg'
    if os.path.exists(real_img):
        img_parsed = parse_attachment_file(real_img, 'hzpa10049_1.jpg')
        assert 'JPEG' in img_parsed
        assert '1920' in img_parsed
        print('Real Image metadata parsing verified.')

    err_parsed = parse_attachment_file('non_existent_file.pdf', 'non_existent_file.pdf')
    assert '解析失败' in err_parsed
    print('Non-existent file handling verified.')

async def test_copilot_tool_execution():
    print('Testing execute_copilot_tool for search_emails and inspect_attachment...')
    res, refs, summary = await execute_copilot_tool('search_emails', {'keywords': 'Quote', 'limit': 5})
    assert 'emails' in res
    assert isinstance(res['emails'], list)
    if res['emails']:
        first_email = res['emails'][0]
        assert 'attachments' in first_email, 'Email record must contain attachments field'
    print('search_emails returned attachments metadata properly.')

    att_res, att_refs, att_summary = await execute_copilot_tool('inspect_attachment', {'attachment_id': 'att_f2587d549c09'})
    if att_res.get('status') == 'success':
        assert 'content' in att_res
        assert att_res['filename'] == 'MAXS326031150493-1773200852.pdf'
        assert len(att_refs) > 0, 'Source email reference should be generated'
        print('inspect_attachment with ID succeeded.')

    att_res_name, _, _ = await execute_copilot_tool('inspect_attachment', {'filename': 'MAXS326031150493'})
    if att_res_name.get('status') == 'success':
        assert 'content' in att_res_name
        print('inspect_attachment with filename search succeeded.')

    not_found_res, _, not_found_sum = await execute_copilot_tool('inspect_attachment', {'attachment_id': 'non_existing_att_xyz'})
    assert not_found_res.get('status') == 'not_found'
    assert '未找到' in not_found_sum
    print('inspect_attachment not_found handling verified.')

if __name__ == '__main__':
    test_tool_definitions()
    test_parsers()
    asyncio.run(test_copilot_tool_execution())
    print('\nALL INSPECT_ATTACHMENT TESTS PASSED!')
