using Autofills.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace UploaderService.Controllers
{
    [Route("BusWankers")]
    [ApiController]
    [AllowAnonymous]

    public class UploadServiceController : ControllerBase
    {
        [HttpPost]
        public async void Upload()
        {
            await Task.Run(() =>
            {
                string inputFile = @".\Spreadsheet.xlsx";
                string outputPath = @".\\Autofills";

                if(BusWankers.CheckPaths(inputFile, outputPath + "\\dummytext.txt"))
                    ExcelFileHelper.SaveAsCsv(inputFile, outputPath);

                BusWankers.GenerateAutofillText($"{outputPath}\\Thursday - Coach.csv", $"{outputPath}\\bw_autofills.txt");
                BusWankers.GenerateAutofillText($"{outputPath}\\Sunday - General.csv", $"{outputPath}\\g_autofills.txt");
            });
        }
    }

}
